import { Zip, ZipPassThrough } from "fflate";

export interface ZipEntry {
  name: string;
  url: string;
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
