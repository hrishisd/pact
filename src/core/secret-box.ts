// Encrypts the secrets adapters keep in the database (Oura's tokens,
// AnkiWeb's host key) with a 32-byte key from the server's config.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretBox {
  /** AES-256-GCM with a fresh IV each time: "iv.tag.ciphertext", each base64url. */
  encrypt(text: string): string;
  decrypt(stored: string): string;
}

/** A box for `key`, 32 bytes as base64; `name` says whose key it is when it isn't. */
export function secretBox(key: string, name: string): SecretBox {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) throw new Error(`the ${name} must be 32 bytes, base64`);
  return {
    encrypt(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", bytes, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
    },
    decrypt(stored) {
      const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64url")) as [
        Buffer,
        Buffer,
        Buffer,
      ];
      // A tag shorter than the 16 bytes encrypt writes would weaken the check, so it's refused.
      const decipher = createDecipheriv("aes-256-gcm", bytes, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    },
  };
}
