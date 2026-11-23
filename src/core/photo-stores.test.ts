// The production photo stores, tested at the PhotoStore port: the local-disk
// one against a temporary directory, the R2 one with a stand-in fetch that
// records each request, so nothing reaches the network.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { FakeClock } from "./testing/fakes.ts";
import { localDiskPhotoStore, r2PhotoStore } from "./photo-stores.ts";

const MONDAY_6PM = new Date("2026-01-05T18:00:00-05:00");
const JPEG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: "image/jpeg" };

function photosDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pact-photos-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "photos");
}

describe("local-disk photo store", () => {
  test("gives back the stored bytes and content type, received at the clock's time", async () => {
    const store = localDiskPhotoStore(photosDir(), new FakeClock(MONDAY_6PM));

    const stored = await store.store(JPEG);

    expect(stored.receivedAt).toEqual(MONDAY_6PM);
    expect(await store.fetch(stored.photoId)).toEqual(JPEG);
  });

  test("a store opened later on the same directory still has the photo", async () => {
    const dir = photosDir();
    const { photoId } = await localDiskPhotoStore(dir, new FakeClock(MONDAY_6PM)).store(JPEG);

    const reopened = localDiskPhotoStore(dir, new FakeClock(MONDAY_6PM));

    expect(await reopened.fetch(photoId)).toEqual(JPEG);
  });

  test("each photo gets its own id", async () => {
    const store = localDiskPhotoStore(photosDir(), new FakeClock(MONDAY_6PM));
    const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" };

    const first = await store.store(JPEG);
    const second = await store.store(png);

    expect(first.photoId).not.toBe(second.photoId);
    expect(await store.fetch(first.photoId)).toEqual(JPEG);
    expect(await store.fetch(second.photoId)).toEqual(png);
  });

  test("an id it never gave out finds nothing", async () => {
    const store = localDiskPhotoStore(photosDir(), new FakeClock(MONDAY_6PM));

    expect(await store.fetch("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  test("an id that is a path finds nothing, even when that path is a file", async () => {
    const dir = photosDir();
    const store = localDiskPhotoStore(join(dir, "inner"), new FakeClock(MONDAY_6PM));
    const { photoId } = await localDiskPhotoStore(dir, new FakeClock(MONDAY_6PM)).store(JPEG);

    expect(await store.fetch(`../${photoId}`)).toBeNull();
  });
});

const BUCKET = {
  bucket: "pact-photos",
  endpoint: "https://0123abcd.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
};

/** A fetch that records each request and answers with the next of `responses`. */
function recordingFetch(...responses: Response[]) {
  const requests: Request[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error("no response left for " + request.url);
    return response;
  };
  return { fetch, requests };
}

describe("R2 photo store", () => {
  test("stores a photo with one signed PUT into the bucket, received at the clock's time", async () => {
    const { fetch, requests } = recordingFetch(new Response(null, { status: 200 }));
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), fetch);

    const stored = await store.store(JPEG);

    expect(stored.receivedAt).toEqual(MONDAY_6PM);
    expect(requests).toHaveLength(1);
    const put = requests[0]!;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`https://0123abcd.r2.cloudflarestorage.com/pact-photos/${stored.photoId}`);
    expect(put.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await put.arrayBuffer())).toEqual(JPEG.bytes);
    // Signed for R2 (region "auto", service "s3") at the clock's time, 23:00 UTC.
    expect(put.headers.get("x-amz-date")).toBe("20260105T230000Z");
    expect(put.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key-id\/20260105\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  test("fetches a photo with a signed GET and keeps its content type", async () => {
    const { fetch, requests } = recordingFetch(
      new Response(null, { status: 200 }),
      new Response(JPEG.bytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), fetch);
    const { photoId } = await store.store(JPEG);

    const photo = await store.fetch(photoId);

    expect(photo).toEqual(JPEG);
    const get = requests[1]!;
    expect(get.method).toBe("GET");
    expect(get.url).toBe(`https://0123abcd.r2.cloudflarestorage.com/pact-photos/${photoId}`);
    expect(get.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key-id\//);
  });

  test("an id the bucket doesn't have finds nothing", async () => {
    const { fetch } = recordingFetch(new Response("NoSuchKey", { status: 404 }));
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), fetch);

    expect(await store.fetch("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  test("an id that is a path finds nothing without asking the bucket", async () => {
    const { fetch, requests } = recordingFetch();
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), fetch);

    expect(await store.fetch("../other-bucket/key")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("a store the bucket refuses fails rather than giving out an id", async () => {
    const { fetch } = recordingFetch(new Response("AccessDenied", { status: 403 }));
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), fetch);

    await expect(store.store(JPEG)).rejects.toThrow(/403/);
  });

  test("a store or a fetch that takes too long is abandoned", async () => {
    // Answers only by rejecting once the request's signal aborts.
    const hanging = (request: Request) =>
      new Promise<Response>((_resolve, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason)),
      );
    const store = r2PhotoStore(BUCKET, new FakeClock(MONDAY_6PM), hanging, 20);

    // The timeout itself, not some other failure on the way.
    await expect(store.store(JPEG)).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(store.fetch("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});
