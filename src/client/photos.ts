// Shrinking a photo before upload: the browser redraws it so its long edge is
// at most PHOTO_SHRINK.maxEdge pixels and saves it as JPEG. Uploads stay fast
// on cellular, and the redraw drops the original's metadata, GPS location
// included. Excuse photos (ticket 07) go through here too.

import { useEffect, useRef, useState, type ChangeEvent } from "react";

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

/**
 * Photos picked from a file input, each shrunk before it's shown; at most
 * `max`. `input` goes on a hidden file input with `onChange` as its change
 * handler, and `choose` opens it. A photo that can't be read says
 * `unreadable` through `setError`, which a new pick clears first.
 * Thumbnails' object URLs are revoked when a photo is removed and when the
 * screen goes; a pick that finishes after that is dropped.
 */
export function usePhotoPicks({
  max,
  unreadable,
  setError,
}: {
  max: number;
  unreadable: string;
  setError: (error: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ShrunkPhoto[]>([]);
  const urls = useRef<string[]>([]);
  urls.current = photos.map((photo) => photo.url);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const add = async (files: File[]) => {
    setError(null);
    for (const file of files.slice(0, max - photos.length)) {
      try {
        const photo = await shrinkForPreview(file);
        if (!mounted.current) {
          URL.revokeObjectURL(photo.url);
          return;
        }
        setPhotos((added) => {
          if (added.length < max) return [...added, photo];
          URL.revokeObjectURL(photo.url);
          return added;
        });
      } catch {
        if (mounted.current) setError(unreadable);
      }
    }
  };
  /** The input's change handler: adds what was picked, and empties the input so the same file can be picked again. */
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length > 0) void add(files);
  };
  const choose = () => input.current?.click();
  const remove = (photo: ShrunkPhoto) => {
    URL.revokeObjectURL(photo.url);
    setPhotos((added) => added.filter((p) => p !== photo));
  };
  return { input, photos, onChange, choose, remove };
}
