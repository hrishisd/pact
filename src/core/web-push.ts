// The production Notifier: Web Push, sent directly from this server with no
// push service of ours in between (ADR 0002). Each message is encrypted for the
// device (RFC 8291) and signed with our VAPID keys (RFC 8292).

import { createECDH, createPrivateKey, hkdfSync, randomBytes, sign, createCipheriv } from "node:crypto";
import type { Clock, DeliveryReport, Notifier, OutgoingPush, PushDevice } from "./ports.ts";

export interface VapidKeys {
  /** Base64url: the raw uncompressed P-256 point the browser subscribes with. */
  publicKey: string;
  /** Base64url: the raw P-256 private value. */
  privateKey: string;
  /** How the push service can reach the operator: a mailto: URL. */
  subject: string;
}

interface WebPushOptions {
  /** Replaceable so tests stay offline. */
  fetch?: (request: Request) => Promise<Response>;
  log?: (line: string) => void;
}

/** How long a push service keeps a message for a device that's offline. */
const TTL_SECONDS = 7 * 24 * 60 * 60;
/** How long our signature is good for; each message gets a new one. */
const SIGNATURE_LIFETIME_SECONDS = 60 * 60;
const SEND_TIMEOUT_MS = 10_000;
/** Push services take about 4 KB. A rejection's reason can be longer, so text is clipped. */
const MAX_TITLE_CHARS = 100;
const MAX_BODY_CHARS = 300;
const RECORD_SIZE = 4096;

export function webPushNotifier(vapid: VapidKeys, clock: Clock, options: WebPushOptions = {}): Notifier {
  const { fetch = globalThis.fetch, log = (line) => console.log(line) } = options;

  /** Whether the push service took it, refused it for good, or says the device is gone. Throws when a retry could help. */
  const send = async (message: Buffer, device: PushDevice): Promise<"sent" | "refused" | "expired"> => {
    const { origin, host } = new URL(device.endpoint);
    const response = await fetch(
      new Request(device.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${signedToken(vapid, origin, clock)}, k=${vapid.publicKey}`,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(TTL_SECONDS),
          Urgency: "high",
        },
        body: new Uint8Array(encryptForDevice(message, device)),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }),
    );
    if (response.ok) return "sent";
    if (response.status === 404 || response.status === 410) return "expired";
    // This message won't go better next time. (401 and 403 might, once our keys
    // are fixed, so they're retried.) Endpoints are credentials, so logs name only the service.
    if (response.status === 400 || response.status === 413) {
      log(`push refused: ${response.status} from ${host}: ${await response.text().catch(() => "")}`);
      return "refused";
    }
    throw new Error(`push failed: ${response.status} from ${host}`);
  };

  return {
    async deliver(push: OutgoingPush, devices: readonly PushDevice[]): Promise<DeliveryReport> {
      const { title, body, url } = push.payload;
      // What the service worker reads (src/client/public/sw.js): the text to show, the page it opens and the icon's badge, if any.
      const message = Buffer.from(
        JSON.stringify({
          title: title.slice(0, MAX_TITLE_CHARS),
          body: body.slice(0, MAX_BODY_CHARS),
          url,
          badge: push.badge,
        }),
      );
      const results = await Promise.allSettled(devices.map((device) => send(message, device)));
      const report: DeliveryReport = { expired: [], failed: [] };
      results.forEach((result, i) => {
        const { endpoint } = devices[i]!;
        if (result.status === "rejected") report.failed.push({ endpoint, error: String(result.reason) });
        else if (result.value === "expired") report.expired.push(endpoint);
      });
      log(
        `push ${push.kind} to ${push.recipient}: ${devices.length} devices, ${report.expired.length} expired, ${report.failed.length} failed`,
      );
      return report;
    },
  };
}

/** RFC 8291: `plaintext` as one aes128gcm record only `device` can read. Tests pass `fixed` for the RFC's example. */
export function encryptForDevice(
  plaintext: Uint8Array,
  device: Pick<PushDevice, "p256dh" | "auth">,
  fixed: { salt?: Buffer; serverPrivateKey?: Buffer } = {},
): Buffer {
  const server = createECDH("prime256v1");
  if (fixed.serverPrivateKey) server.setPrivateKey(fixed.serverPrivateKey);
  else server.generateKeys();
  const serverPublicKey = server.getPublicKey();
  const devicePublicKey = Buffer.from(device.p256dh, "base64url");
  const salt = fixed.salt ?? randomBytes(16);

  const hkdf = (secret: Uint8Array, hkdfSalt: Uint8Array, info: Uint8Array, length: number) =>
    Buffer.from(hkdfSync("sha256", secret, hkdfSalt, info, length));
  const ikm = hkdf(
    server.computeSecret(devicePublicKey),
    Buffer.from(device.auth, "base64url"),
    Buffer.concat([Buffer.from("WebPush: info\0"), devicePublicKey, serverPublicKey]),
    32,
  );
  const key = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  // 0x02 marks the last record.
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.update(Buffer.from([2])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublicKey.length]), serverPublicKey, ciphertext]);
}

/** RFC 8292: a short-lived ES256 token saying this server sent the message to `audience`. */
function signedToken(vapid: VapidKeys, audience: string, clock: Clock): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = [
    encode({ typ: "JWT", alg: "ES256" }),
    encode({
      aud: audience,
      exp: Math.floor(clock.now().getTime() / 1000) + SIGNATURE_LIFETIME_SECONDS,
      sub: vapid.subject,
    }),
  ].join(".");
  const point = Buffer.from(vapid.publicKey, "base64url");
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
  });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}
