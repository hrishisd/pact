// Checking a push device before it's saved: a real push service's endpoint
// and keys a notification can be encrypted for.

import { createECDH } from "node:crypto";
import type { PushDevice } from "../shared/types.ts";

/** The push services browsers use, as domains; a saved endpoint must be on one of them. */
const PUSH_SERVICE_DOMAINS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

const P256DH_BYTES = 65;

const AUTH_BYTES = 16;

export function isPushDevice({ endpoint, p256dh, auth }: PushDevice): boolean {
  if (!URL.canParse(endpoint)) return false;
  const { protocol, hostname } = new URL(endpoint);
  return (
    protocol === "https:" &&
    PUSH_SERVICE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
    isBase64UrlOfLength(p256dh, P256DH_BYTES) &&
    isBase64UrlOfLength(auth, AUTH_BYTES) &&
    isPointOnCurve(p256dh)
  );
}

/** Encrypting for a key that isn't a real P-256 point throws, for every notification to it. */
function isPointOnCurve(publicKey: string): boolean {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  try {
    ecdh.computeSecret(Buffer.from(publicKey, "base64url"));
    return true;
  } catch {
    return false;
  }
}

function isBase64UrlOfLength(text: string, bytes: number): boolean {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(text) && Buffer.from(text, "base64url").length === bytes;
}
