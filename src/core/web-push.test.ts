// The Web Push adapter, at its boundary: what it sends to a push service, and
// what it makes of the answer. Nothing reaches the network.

import { createECDH, createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { Notification, PushDevice } from "./ports.ts";
import { FakeClock } from "./testing/fakes.ts";
import { encryptForDevice, webPushNotifier } from "./web-push.ts";

const NOW = new Date("2026-01-05T23:00:00Z");

/**
 * The same P-256 key pair every run, from `name`. A generated one is a fresh
 * key each run, and about 1 in 256 has a private key shorter than 32 bytes.
 */
function fixedKeys(name: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(createHash("sha256").update(name).digest());
  return ecdh;
}

// A key pair made for these tests.
const vapid = (() => {
  const ecdh = fixedKeys("vapid");
  return { publicKey: ecdh.getPublicKey("base64url"), privateKey: ecdh.getPrivateKey("base64url") };
})();

const notification: Notification = {
  recipient: "reviewer-id",
  kind: "review-item",
  payload: { title: "Sam submitted evidence", body: "Gym · Mon Jan 5", url: "/review", itemId: "secret-detail" },
};

/** A browser's side of a subscription, able to read what's sent to it. */
function browserDevice(name: string): PushDevice {
  const ecdh = fixedKeys(`device ${name}`);
  return {
    endpoint: `https://web.push.apple.com/${name}`,
    p256dh: ecdh.getPublicKey("base64url"),
    auth: Buffer.alloc(16, 5).toString("base64url"),
  };
}

function notifierAnswering(answer: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const logs: string[] = [];
  const notifier = webPushNotifier({ ...vapid, subject: "mailto:operator@example.test" }, new FakeClock(NOW), {
    fetch: async (request) => {
      requests.push(request.clone());
      return answer(request);
    },
    log: (line) => logs.push(line),
  });
  return { notifier, requests, logs };
}

describe("encryption", () => {
  // The worked example in RFC 8291, section 5.
  test("matches the RFC's example", () => {
    const encrypted = encryptForDevice(
      Buffer.from("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
        serverPrivateKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
      },
    );

    expect(Buffer.from(encrypted).toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
});

describe("what's sent to the push service", () => {
  test("an encrypted POST to the device's endpoint, identified with our keys", async () => {
    const { notifier, requests } = notifierAnswering(() => new Response(null, { status: 201 }));
    const device = browserDevice("phone");

    expect(await notifier.deliver(notification, [device])).toEqual({ expired: [], failed: [] });

    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(device.endpoint);
    expect(request?.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(Number(request?.headers.get("TTL"))).toBeGreaterThan(0);
    const bytes = Buffer.from(await request!.arrayBuffer());
    expect(bytes.toString()).not.toContain("Sam");

    const authorization = /^vapid t=([^,]+), k=(.+)$/.exec(request!.headers.get("Authorization")!);
    expect(authorization?.[2]).toBe(vapid.publicKey);
    const [header, claims, signature] = authorization![1]!.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: NOW.getTime() / 1000 + 60 * 60,
      sub: "mailto:operator@example.test",
    });
    const publicKey = Buffer.from(vapid.publicKey, "base64url");
    const key = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33, 65).toString("base64url"),
      },
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  test("no devices sends nothing", async () => {
    const { notifier, requests } = notifierAnswering(() => new Response(null, { status: 201 }));

    expect(await notifier.deliver(notification, [])).toEqual({ expired: [], failed: [] });
    expect(requests).toEqual([]);
  });

  test("a very long body still fits a push message", async () => {
    const { notifier, requests } = notifierAnswering(() => new Response(null, { status: 201 }));
    const long = { ...notification, payload: { ...notification.payload, body: "ü".repeat(10_000) } };

    await notifier.deliver(long, [browserDevice("phone")]);

    expect((await requests[0]!.arrayBuffer()).byteLength).toBeLessThan(3000);
  });
});

describe("what the push service answers", () => {
  test.each([404, 410])("%i: the device has expired, and others are still sent to", async (status) => {
    const gone = browserDevice("gone");
    const kept = browserDevice("kept");
    const { notifier, requests } = notifierAnswering(
      (request) => new Response(null, { status: request.url === gone.endpoint ? status : 201 }),
    );

    expect(await notifier.deliver(notification, [gone, kept])).toEqual({ expired: [gone.endpoint], failed: [] });
    expect(requests).toHaveLength(2);
  });

  test.each([500, 503, 429, 408, 401, 403])(
    "%i: reported as failed, so the core retries that device",
    async (status) => {
      const failing = browserDevice("failing");
      const fine = browserDevice("fine");
      const { notifier, requests } = notifierAnswering(
        (request) => new Response(null, { status: request.url === failing.endpoint ? status : 201 }),
      );

      expect(await notifier.deliver(notification, [failing, fine])).toEqual({
        expired: [],
        failed: [{ endpoint: failing.endpoint, error: expect.stringContaining(String(status)) }],
      });
      expect(requests).toHaveLength(2);
    },
  );

  test("no answer at all: failed", async () => {
    const { notifier } = notifierAnswering(() => Promise.reject(new TypeError("fetch failed")));

    const device = browserDevice("phone");
    expect(await notifier.deliver(notification, [device])).toEqual({
      expired: [],
      failed: [{ endpoint: device.endpoint, error: expect.stringContaining("fetch failed") }],
    });
  });

  test.each([400, 413])(
    "%i: retrying can't help, so it's logged and not retried, and the device stays",
    async (status) => {
      const { notifier, logs } = notifierAnswering(() => new Response("BadJwtToken", { status }));

      expect(await notifier.deliver(notification, [browserDevice("phone")])).toEqual({ expired: [], failed: [] });
      expect(logs).toContainEqual(expect.stringMatching(new RegExp(`refused.*${status}.*web\\.push\\.apple\\.com`)));
      expect(logs.join("\n")).not.toContain("/phone");
    },
  );
});
