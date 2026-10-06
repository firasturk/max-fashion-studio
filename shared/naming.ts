/** Output naming rules shared by the server (export manifest) and the client (ZIP builder). */

/** Strip the extension and any trailing "-AI" so uploads of earlier results never double the suffix. Keeps folder segments. */
export function stemOf(name: string): string {
  return name.replace(/\.[^./]+$/, "").replace(/-AI$/i, "");
}

/** Case-insensitive key used to reject two uploads that would produce the same output file. */
export function stemKey(name: string): string {
  return stemOf(name).normalize("NFC").toLowerCase();
}

/** Trailing shot counters: `_01`, `-2`, ` (3)` and an earlier result's `_0_4`. */
const COUNTER = /(?:_0_\d{1,3}|[\s_-]+\d{1,2}|\s*\(\d{1,3}\))$/;

/**
 * Product id of an upload, folder kept and case kept: `Denim/169800580_01.jpg` -> `Denim/169800580`.
 * The extension, "-AI", a trailing one- or two-digit counter such as _01 / -2 / (3) and an earlier
 * result's `_0_N` are removed. Three-digit endings like MAX_001 are part of the id.
 */
export function productId(name: string): string {
  return stemOf(name).normalize("NFC").replace(COUNTER, "");
}

/**
 * Files of one product share a key (the product id, case-insensitive): `169800580_01.jpg` and
 * `169800580_02.jpg` -> `169800580`. Images of one product are generated as one set with the same
 * scene and light, and numbered together on export.
 */
export function productKey(name: string): string {
  return productId(name).toLowerCase();
}

/**
 * Export name of a generated image: the product id, then `_0_` and the image's number within its
 * product: `Denim/169800580_01.jpg` -> `Denim/169800580_0_1.png`, its sibling `_02` -> `_0_2`.
 * The extension follows the bytes the engine returned.
 */
export function outputName(sourceName: string, index: number, ext = "png"): string {
  return `${productId(sourceName)}_0_${index}.${ext}`;
}

/**
 * Numbers generated images per product, in upload-name then card order, so `_01` card 1 is 1,
 * `_01` card 2 is 2, `_02` card 1 is 3, and so on. The numbering covers every item passed in,
 * so one image keeps its number whether it is downloaded alone, as a set or as the whole batch.
 */
export function numberOutputs<T>(
  items: T[],
  sourceName: (item: T) => string,
  card: (item: T) => number,
): Map<T, number> {
  const sorted = [...items].sort(
    (a, b) => sourceName(a).localeCompare(sourceName(b)) || card(a) - card(b),
  );
  const counters = new Map<string, number>();
  const out = new Map<T, number>();
  for (const item of sorted) {
    const key = productKey(sourceName(item));
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    out.set(item, n);
  }
  return out;
}

/** Extension of a stored result key (`.../uuid.jpg` -> `jpg`). */
export function outputExt(key: string | null | undefined): string {
  const m = /\.([a-z0-9]+)$/i.exec(key ?? "");
  return m ? m[1].toLowerCase() : "png";
}

/** Safe archive filename (ASCII only, keeps dots/dashes/underscores). */
export function safeArchiveName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/_+/g, "_") || "batch";
}

/** Relative paths from folder uploads are allowed (`Denim/MAX_001.jpg`); traversal, absolute paths and control characters are not. */
export function isValidSourceName(name: string): boolean {
  if (name.length === 0 || name.length > 300) return false;
  if (name.startsWith("/") || name.includes("\\")) return false;
  for (const ch of name) if (ch.charCodeAt(0) < 0x20) return false;
  const segments = name.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

/** Normalises a browser-provided relative path: strips a leading top-level folder name when it is the only root. */
export function relativeUploadName(path: string, fallback: string): string {
  const clean = (path || fallback).replace(/^\.?\//, "");
  return clean || fallback;
}
