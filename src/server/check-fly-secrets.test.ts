// The deploy's check that Fly has every variable loadConfig requires. It lives
// in scripts/ and runs the real config.ts; only fly.toml and the listing are fakes.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadConfig } from "./config.ts";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "check-fly-secrets.sh");
const DIGEST = "digest-that-must-never-be-printed";
const IN_FLY_TOML = ["PACT_DB_PATH", "BETTER_AUTH_URL"];

const dir = mkdtempSync(join(tmpdir(), "check-fly-secrets-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FLY_TOML = join(dir, "fly.toml");
writeFileSync(
  FLY_TOML,
  `app = "pact-test"
PHOTOS_BUCKET = "outside any section, so not an env var"

[env]
  NODE_ENV = "production"
${IN_FLY_TOML.map((name) => `  ${name} = "value-from-fly-toml"`).join("\n")}

[build]
  OPERATOR_EMAIL = "in another section, so not an env var"
`,
);

/** The names loadConfig reports when production has none of them. */
function requiredNames(): string[] {
  try {
    loadConfig({ NODE_ENV: "production" });
  } catch (error) {
    return (error as Error).message.replace(/^.*: /, "").split(", ");
  }
  throw new Error("loadConfig required nothing");
}

/** What `fly secrets list --json` prints for these names. */
function listing(names: string[], status = "Deployed"): string {
  return JSON.stringify(names.map((name) => ({ name, digest: DIGEST, status })));
}

const secretNames = () => requiredNames().filter((name) => !IN_FLY_TOML.includes(name));

/** Runs the check with a listing command that prints `stdout`. */
function check(stdout: string, flyToml = FLY_TOML) {
  return checkWithCommand(["printf", "%s", stdout], flyToml);
}

function checkWithCommand(command: string[], flyToml = FLY_TOML, path = process.env.PATH) {
  const result = spawnSync("/bin/bash", [SCRIPT, flyToml, ...command], {
    encoding: "utf8",
    env: { PATH: path },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("check-fly-secrets", () => {
  test("reads the required names from config.ts, photos included", () => {
    expect(requiredNames()).toContain("PHOTOS_BUCKET");
    expect(requiredNames()).toContain("PACT_DB_PATH");
  });

  test("passes when every name is a secret or in fly.toml", () => {
    const { status, output } = check(listing(secretNames()));
    expect(output).not.toContain("::warning::");
    expect(output).not.toContain("::error::");
    expect(status).toBe(0);
  });

  test("fails naming the missing secret, printing no digest or value", () => {
    const { status, output } = check(listing(secretNames().filter((n) => n !== "PHOTOS_ENDPOINT")));
    expect(status).not.toBe(0);
    expect(output).toContain("::error::");
    expect(output).toContain("PHOTOS_ENDPOINT");
    expect(output).not.toContain("PHOTOS_BUCKET");
    expect(output).not.toContain(DIGEST);
    expect(output).not.toContain("value-from-fly-toml");
  });

  test("a staged secret counts as present", () => {
    const { status, output } = check(listing(secretNames(), "Staged"));
    expect(output).not.toContain("::error::");
    expect(status).toBe(0);
  });

  test("a variable in fly.toml's [env] counts, one elsewhere in the file doesn't", () => {
    // PACT_DB_PATH and BETTER_AUTH_URL aren't listed, and pass through [env].
    expect(check(listing(secretNames())).status).toBe(0);

    const withoutEnv = join(dir, "no-db-path.toml");
    writeFileSync(withoutEnv, `[env]\n  BETTER_AUTH_URL = "x"\n`);
    const { status, output } = check(listing(secretNames()), withoutEnv);
    expect(status).not.toBe(0);
    expect(output).toContain("PACT_DB_PATH");

    const inOtherSections = secretNames().filter((n) => !["PHOTOS_BUCKET", "OPERATOR_EMAIL"].includes(n));
    const elsewhere = check(listing(inOtherSections));
    expect(elsewhere.status).not.toBe(0);
    expect(elsewhere.output).toContain("PHOTOS_BUCKET");
    expect(elsewhere.output).toContain("OPERATOR_EMAIL");
  });

  describe("warns and lets the deploy continue", () => {
    const warned = ({ status, output }: { status: number | null; output: string }) => {
      expect(output).toContain("::warning::");
      expect(output).not.toContain("::error::");
      expect(output).not.toContain(DIGEST);
      expect(status).toBe(0);
    };

    test("when listing fails, keeping the listing's own error in the log", () => {
      const result = checkWithCommand(["bash", "-c", "echo 'Error: unauthorized' >&2; exit 1"]);
      warned(result);
      expect(result.output).toContain("Error: unauthorized");
    });

    test("when the listing command doesn't exist", () => {
      warned(checkWithCommand(["no-such-command-for-this-test"]));
    });

    test.each([
      ["garbage", `not json ${DIGEST}`],
      ["empty output", ""],
      ["an empty list", "[]"],
      ["an object instead of a list", JSON.stringify({ name: "PHOTOS_BUCKET", digest: DIGEST })],
      ["entries with another shape", JSON.stringify([{ Name: "PHOTOS_BUCKET", digest: DIGEST }])],
      ["one bad entry among good ones", JSON.stringify([{ name: "OPERATOR_EMAIL" }, { digest: DIGEST }])],
    ])("when the listing is %s", (_name, stdout) => {
      warned(check(stdout));
    });

    test("when fly.toml can't be read", () => {
      warned(check(listing(secretNames()), join(dir, "no-such-file.toml")));
    });

    test("when fly.toml has no [env]", () => {
      const noEnv = join(dir, "no-env.toml");
      writeFileSync(noEnv, `app = "pact-test"\n`);
      warned(check(listing(secretNames()), noEnv));
    });

    test("when node or jq isn't there", () => {
      warned(checkWithCommand(["/usr/bin/false"], FLY_TOML, join(dir, "empty-path")));
      warned(checkWithCommand(["/usr/bin/printf", "%s", listing(secretNames())], FLY_TOML, join(dir, "empty-path")));
    });
  });
});
