/** Reading Pinterest links and its public board feed. Shared by the Worker and the tests. */

export type PinterestTarget =
  | { kind: "board"; user: string; board: string }
  | { kind: "pin"; id: string }
  | { kind: "short"; url: string };

/** First path segments that are Pinterest's own pages, not a person's boards. */
const RESERVED = new Set([
  "pin",
  "search",
  "ideas",
  "today",
  "explore",
  "business",
  "settings",
  "login",
  "signup",
  "_",
]);

export function parsePinterestLink(link: string): PinterestTarget | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "pin.it") return u.pathname.length > 1 ? { kind: "short", url: u.toString() } : null;
  if (!/(^|\.)pinterest\.[a-z.]{2,6}$/.test(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "pin" && parts[1]) {
    const id = /(\d{6,})$/.exec(parts[1])?.[1];
    return id ? { kind: "pin", id } : null;
  }
  if (parts.length >= 2 && !RESERVED.has(parts[0].toLowerCase()) && !parts[1].startsWith("_"))
    return { kind: "board", user: parts[0], board: parts[1] };
  return null;
}

export interface Pin {
  id: string;
  /** A small picture for the chooser. */
  thumb: string;
  /** The picture kept as a reference photo. */
  image: string;
  note: string;
}

const PINIMG =
  /^https:\/\/i\.pinimg\.com\/(\d+x|originals)\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]+\.(?:jpe?g|png|webp))$/i;

/** Only pictures on Pinterest's own image host are ever fetched. */
export function pinImage(url: string, size: "236x" | "736x"): string | null {
  const m = PINIMG.exec(url);
  return m ? `https://i.pinimg.com/${size}/${m[2]}` : null;
}

interface RawPin {
  id?: unknown;
  is_video?: unknown;
  description?: unknown;
  images?: Record<string, { url?: unknown } | undefined>;
}

/** The still pictures in an answer from Pinterest's public feed, in the board's own order. */
export function readPins(raw: unknown): Pin[] {
  const out: Pin[] = [];
  const seen = new Set<string>();
  for (const p of (Array.isArray(raw) ? raw : []) as RawPin[]) {
    const id = typeof p?.id === "string" ? p.id : "";
    const url = Object.values(p?.images ?? {})
      .map((i) => i?.url)
      .find((v): v is string => typeof v === "string");
    const thumb = url ? pinImage(url, "236x") : null;
    const image = url ? pinImage(url, "736x") : null;
    if (!id || !thumb || !image || p.is_video === true || seen.has(image)) continue;
    seen.add(image);
    out.push({
      id,
      thumb,
      image,
      note: typeof p.description === "string" ? p.description.trim().slice(0, 140) : "",
    });
  }
  return out;
}
