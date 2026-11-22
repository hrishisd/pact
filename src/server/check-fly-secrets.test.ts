// The deploy's check that Fly has every variable loadConfig requires. It lives
// in scripts/ and runs the real config.ts; only fly.toml and the listing are fakes.

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { loadConfig } from "./config.ts";

// Each test starts bash and node (about 1 s alone, 2 s or more on a loaded
// machine), so the 5 s default would fail a busy CI runner, not a bug.
vi.setConfig({ testTimeout: 30_000 });

const REPO = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO, "scripts", "check-fly-secrets.sh");
const DIGEST = "digest-that-must-never-be-printed";
const IN_FLY_TOML = ["PACT_DB_PATH", "BETTER_AUTH_URL"];

/** Where `name` is on the PATH vitest was started with, or undefined. */
function which(name: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => join(entry, name))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

// The script runs `node` and `jq` from PATH. Its node is the one running these
// tests, not whichever is first on the machine's PATH, and a missing jq fails
// here rather than turning every check into a skip warning.
const JQ =
  which("jq") ??
  (() => {
    throw new Error("check-fly-secrets tests need jq on PATH, as the deploy job has");
  })();
const TOOLS_PATH = [dirname(process.execPath), dirname(JQ), "/usr/bin", "/bin"].join(delimiter);

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

/** Read by the container's entrypoint and litestream.yml, not by loadConfig. */
const BACKUP_NAMES = [
  "LITESTREAM_BUCKET",
  "LITESTREAM_ENDPOINT",
  "LITESTREAM_ACCESS_KEY_ID",
  "LITESTREAM_SECRET_ACCESS_KEY",
];

const secretNames = () => [...requiredNames().filter((name) => !IN_FLY_TOML.includes(name)), ...BACKUP_NAMES];

/** Runs the check with a listing command that prints `stdout`. */
function check(stdout: string, flyToml = FLY_TOML) {
  return checkWithCommand(["printf", "%s", stdout], flyToml);
}

function checkWithCommand(command: string[], flyToml = FLY_TOML, path = TOOLS_PATH) {
  const result = spawnSync("/bin/bash", [SCRIPT, flyToml, ...command], {
    encoding: "utf8",
    env: { PATH: path },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("check-fly-secrets", () => {
  test("reads the required names from config.ts, photos and Gmail included", () => {
    expect(requiredNames()).toContain("PHOTOS_BUCKET");
    expect(requiredNames()).toEqual(expect.arrayContaining(["GMAIL_ADDRESS", "GMAIL_APP_PASSWORD"]));
    expect(requiredNames()).toContain("PACT_DB_PATH");
  });

  test("passes when every name is a secret or in fly.toml", () => {
    const { status, output } = check(listing(secretNames()));
    expect(output).toContain("Fly secrets check passed");
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

  test("fails naming a missing backup secret, which loadConfig doesn't read", () => {
    const { status, output } = check(listing(secretNames().filter((n) => n !== "LITESTREAM_BUCKET")));
    expect(status).not.toBe(0);
    expect(output).toContain("::error::Production won't boot without: LITESTREAM_BUCKET.");
    expect(output).not.toContain(DIGEST);
  });

  test("an optional secret that needs others fails without them: Oura's client id alone", () => {
    const { status, output } = check(listing([...secretNames(), "OURA_CLIENT_ID"]));
    expect(status).not.toBe(0);
    expect(output).toContain("::error::Production won't boot without: OURA_CLIENT_SECRET OURA_TOKEN_KEY.");

    const withOura = check(listing([...secretNames(), "OURA_CLIENT_ID", "OURA_CLIENT_SECRET", "OURA_TOKEN_KEY"]));
    expect(withOura.output).toContain("Fly secrets check passed");
    expect(withOura.status).toBe(0);
  });

  test("a staged secret counts as present", () => {
    const { status, output } = check(listing(secretNames(), "Staged"));
    expect(output).toContain("Fly secrets check passed");
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

    /** A PATH directory with everything else the script runs, and without `leftOut`. */
    const binWithout = (leftOut: string) => {
      const bin = join(dir, `no-${leftOut}-bin`);
      mkdirSync(bin);
      const tools: Record<string, string | undefined> = { node: process.execPath, jq: JQ };
      for (const tool of ["dirname", "awk", "printf"]) tools[tool] = which(tool);
      for (const [tool, found] of Object.entries(tools)) {
        if (tool === leftOut) continue;
        if (found === undefined) throw new Error(`check-fly-secrets tests need ${tool} on PATH`);
        symlinkSync(found, join(bin, tool));
      }
      return bin;
    };

    test("when node isn't there", () => {
      const result = checkWithCommand(["printf", "%s", listing(secretNames())], FLY_TOML, binWithout("node"));
      warned(result);
      expect(result.output).toContain("couldn't read the required names");
    });

    test("when jq isn't there", () => {
      const result = checkWithCommand(["printf", "%s", listing(secretNames())], FLY_TOML, binWithout("jq"));
      warned(result);
      expect(result.output).toContain("couldn't read the output of the secrets listing");
    });
  });

  test("the setup wizard sets every secret the check requires, so a from-scratch setup boots", () => {
    // The secrets are the required names the real fly.toml's [env] doesn't give.
    const flyToml = readFileSync(join(REPO, "fly.toml"), "utf8");
    const envSection = /^\[env\]\n((?:[ \t]+.*\n|\n)*)/m.exec(flyToml)?.[1] ?? "";
    const inEnv = [...envSection.matchAll(/^\s+([A-Z_]+)\s*=/gm)].map((match) => match[1]);
    const wizard = readFileSync(join(REPO, "scripts", "setup-operator.sh"), "utf8");
    const needed = [...requiredNames(), ...BACKUP_NAMES].filter((name) => !inEnv.includes(name));
    expect(needed).toContain("GMAIL_APP_PASSWORD");
    expect(needed).not.toContain("PACT_DB_PATH");
    expect(needed.filter((name) => !wizard.includes(`"${name}=$${name}"`))).toEqual([]);
  });
});
