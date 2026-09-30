/** Output naming rules shared by the server (export manifest) and the client (ZIP builder). */

/** Strip the extension and any trailing "-AI" so uploads of earlier results never double the suffix. Keeps folder segments. */
export function stemOf(name: string): string {
  return name.replace(/\.[^./]+$/, "").replace(/-AI$/i, "");
}

/** Case-insensitive key used to reject two uploads that would produce the same output file. */
export function stemKey(name: string): string {
  return stemOf(name).normalize("NFC").toLowerCase();
}

/**
 * `MAX_001.jpg` -> `MAX_001-AI.png`; six-card sets -> `MAX_001/card-01/MAX_001-AI.png`;
 * multi-image sets -> `MAX_001-AI-02.png`. The extension follows the bytes the engine returned.
 */
export function outputName(
  sourceName: string,
  card: number,
  mode: string,
  total = 1,
  ext = "png",
): string {
  const stem = stemOf(sourceName);
  if (mode === "1") return `${stem}/card-${String(card).padStart(2, "0")}/${stem}-AI.${ext}`;
  if (total > 1) return `${stem}-AI-${String(card).padStart(2, "0")}.${ext}`;
  return `${stem}-AI.${ext}`;
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
