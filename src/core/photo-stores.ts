// Production adapters for the PhotoStore port: a private Cloudflare R2 bucket
// in production, a directory on local disk in development. The store, never
// the caller, names each photo, so a photo id is never a path.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import type { Clock, Photo, PhotoStore, StoredPhoto } from "./ports.ts";

const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Each photo is two files in `dir`: `<id>` holds the bytes, `<id>.type` the content type. */
export function localDiskPhotoStore(dir: string, clock: Clock): PhotoStore {
  return {
    async store(photo: Photo): Promise<StoredPhoto> {
      const receivedAt = clock.now();
      const photoId = randomUUID();
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${photoId}.type`), photo.contentType);
      await writeFile(join(dir, photoId), photo.bytes);
      return { photoId, receivedAt };
    },

    async fetch(photoId: string): Promise<Photo | null> {
      if (!PHOTO_ID.test(photoId)) return null;
      try {
        const [bytes, contentType] = await Promise.all([
          readFile(join(dir, photoId)),
          readFile(join(dir, `${photoId}.type`), "utf8"),
        ]);
        return { bytes: new Uint8Array(bytes), contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

export interface R2Bucket {
  bucket: string;
  /** The account's S3 API endpoint, https://<account id>.r2.cloudflarestorage.com. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Each photo is one object, keyed by its id, in a private bucket. Requests are
 * signed with the clock's time; `fetch` is replaceable so tests stay offline.
 */
export function r2PhotoStore(
  { bucket, endpoint, accessKeyId, secretAccessKey }: R2Bucket,
  clock: Clock,
  fetch: (request: Request) => Promise<Response> = globalThis.fetch,
): PhotoStore {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const objectUrl = (photoId: string) => `${endpoint.replace(/\/+$/, "")}/${bucket}/${photoId}`;
  /** aws4fetch's X-Amz-Date form, e.g. 20260105T230000Z. */
  const signedAt = () =>
    clock
      .now()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");

  return {
    async store(photo: Photo): Promise<StoredPhoto> {
      const receivedAt = clock.now();
      const photoId = randomUUID();
      const response = await fetch(
        await client.sign(objectUrl(photoId), {
          method: "PUT",
          headers: { "content-type": photo.contentType },
          body: photo.bytes as Uint8Array<ArrayBuffer>,
          aws: { datetime: signedAt() },
        }),
      );
      if (!response.ok) throw new Error(`R2 refused to store photo ${photoId}: ${response.status}`);
      return { photoId, receivedAt };
    },

    async fetch(photoId: string): Promise<Photo | null> {
      if (!PHOTO_ID.test(photoId)) return null;
      const response = await fetch(
        await client.sign(objectUrl(photoId), { method: "GET", aws: { datetime: signedAt() } }),
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 refused to fetch photo ${photoId}: ${response.status}`);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },
  };
}
