/** Output naming rules shared by the server (export manifest) and the client (ZIP builder). */

/** Strip the extension and any trailing "-AI" so uploads of earlier results never double the suffix. */
export function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/-AI$/i, "");
}

/** Case-insensitive key used to reject two uploads that would produce the same output file. */
export function stemKey(name: string): string {
  return stemOf(name).normalize("NFC").toLowerCase();
}

/** `MAX_001.jpg` -> `MAX_001-AI.png`; six-card sets -> `MAX_001/card-01/MAX_001-AI.png`. */
export function outputName(sourceName: string, card: number, mode: string): string {
  const stem = stemOf(sourceName);
  if (mode === "1") return `${stem}/card-${String(card).padStart(2, "0")}/${stem}-AI.png`;
  return `${stem}-AI.png`;
}

/** Safe archive filename (ASCII only, keeps dots/dashes/underscores). */
export function safeArchiveName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/_+/g, "_") || "batch";
}

/** Reject path separators and control characters; keep Unicode names. */
export function isValidSourceName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (ch === "/" || ch === "\\" || code < 0x20) return false;
  }
  return true;
}
