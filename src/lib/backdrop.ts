/** Browser side of the backdrop-colour check: decode each result small and read its border. */
import { readBorder, type BorderRead } from "@shared/backdrop";

/** Download one result and read its border at a small size. */
export async function readResultBorder(url: string): Promise<BorderRead> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), {
    resizeWidth: 96,
    resizeHeight: 96,
    resizeQuality: "low",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return readBorder(data, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

/** Run reads a few at a time, reporting progress. */
export async function readAll<T extends { id: string }>(
  items: T[],
  url: (item: T) => string,
  onProgress: (done: number) => void,
  parallel = 6,
): Promise<Map<string, BorderRead>> {
  const out = new Map<string, BorderRead>();
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          out.set(item.id, await readResultBorder(url(item)));
        } catch {
          // An unreadable image is simply not judged.
        }
        onProgress(++done);
      }
    }),
  );
  return out;
}
