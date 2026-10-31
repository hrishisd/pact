// Shrinking a photo before upload: the browser redraws it so its long edge is
// at most PHOTO_SHRINK.maxEdge pixels and saves it as JPEG. Uploads stay fast
// on cellular, and the redraw drops the original's metadata, GPS location
// included. Excuse photos (ticket 07) go through here too.

/** The one place photo size and quality are set: about 100–180 KB a photo. */
const PHOTO_SHRINK = { maxEdge: 1280, quality: 0.6 } as const;

/** A photo shrunk for upload, and an object URL for its thumbnail, which its holder revokes. */
export interface ShrunkPhoto {
  blob: Blob;
  url: string;
}

/** `photo` shrunk (`shrinkPhoto`), with an object URL to preview it by. */
export async function shrinkForPreview(photo: Blob): Promise<ShrunkPhoto> {
  const blob = await shrinkPhoto(photo);
  return { blob, url: URL.createObjectURL(blob) };
}

/** `photo` redrawn upright, no larger than PHOTO_SHRINK.maxEdge, as a JPEG. */
async function shrinkPhoto(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, PHOTO_SHRINK.maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas to shrink the photo on");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("the shrunk photo couldn't be saved"))),
        "image/jpeg",
        PHOTO_SHRINK.quality,
      ),
    );
  } finally {
    bitmap.close();
  }
}
