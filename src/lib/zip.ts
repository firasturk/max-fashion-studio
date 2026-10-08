import { Zip, ZipPassThrough } from "fflate";

export interface ZipEntry {
  name: string;
  url: string;
  /** Convert the fetched image to this format before adding it (originals are never converted). */
  convert?: { format: "jpg" | "webp"; quality: number; fit?: boolean };
}

/** Export size window: every fitted JPG/WebP lands between these, when the image allows it. */
export const FIT_MIN = 1_000_000;
export const FIT_MAX = 1_900_000;

/**
 * Re-encodes until the file is inside the 1-1.9 MB window: lower quality while too big, raise it
 * while too small, in steps of 5 between 50 and 100. A small image that stays under 1 MB even at
 * quality 100 is kept at 100; a huge one that stays over 1.9 MB at 50 is kept at 50.
 */
export async function fitImage(
  blob: Blob,
  format: "jpg" | "webp",
  startQuality: number,
): Promise<Blob> {
  let q = Math.min(100, Math.max(50, Math.round(startQuality / 5) * 5));
  let out = await convertImage(blob, format, q);
  if (out.size > FIT_MAX) {
    while (out.size > FIT_MAX && q > 50) {
      q -= 5;
      out = await convertImage(blob, format, q);
    }
    return out;
  }
  let best = out;
  while (best.size < FIT_MIN && q < 100) {
    q += 5;
    const next = await convertImage(blob, format, q);
    if (next.size > FIT_MAX) break;
    best = next;
  }
  return best;
}

/** Re-encodes an image blob in the browser. */
export async function convertImage(
  blob: Blob,
  format: "jpg" | "webp",
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    if (format === "jpg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Conversion failed."))),
        format === "jpg" ? "image/jpeg" : "image/webp",
        quality / 100,
      ),
    );
  } finally {
    bitmap.close();
  }
}

const MAX_ARCHIVE = 512 * 1024 * 1024;

/**
 * Streams each file into an uncompressed ZIP (images are already compressed).
 * The archive is assembled in memory, so exports are capped at 512 MB; split large batches by selection.
 */
export async function buildZip(entries: ZipEntry[], manifest: unknown): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finish!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  done.catch(() => {});
  const zip = new Zip((err, data, final) => {
    if (err) return fail(err);
    total += data.length;
    if (total > MAX_ARCHIVE) {
      zip.terminate();
      return fail(new Error("Export exceeds 512 MB. Select fewer results and export in parts."));
    }
    chunks.push(data);
    if (final) finish();
  });

  for (const entry of entries) {
    const r = await fetch(entry.url, { credentials: "same-origin" });
    if (!r.ok || !r.body) throw new Error(`Could not download ${entry.name}. Retry export.`);
    const item = new ZipPassThrough(entry.name);
    zip.add(item);
    if (entry.convert) {
      const converted = entry.convert.fit
        ? await fitImage(await r.blob(), entry.convert.format, entry.convert.quality)
        : await convertImage(await r.blob(), entry.convert.format, entry.convert.quality);
      item.push(new Uint8Array(await converted.arrayBuffer()), true);
      continue;
    }
    const reader = r.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      item.push(value, false);
    }
    item.push(new Uint8Array(), true);
  }
  const m = new ZipPassThrough("manifest.json");
  zip.add(m);
  m.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
  zip.end();
  await done;
  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
