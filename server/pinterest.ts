/**
 * Skills from Pinterest. A public board (or one pin) is read through the feed Pinterest serves
 * for its own embed widgets, so nobody has to sign in. The chosen pictures go into a skill's
 * reference library, where they behave exactly like uploaded photos.
 */
import { StudioError } from "./errors";
import {
  parsePinterestLink,
  pinImage,
  profileBoards,
  readPins,
  type Pin,
  type PinterestTarget,
} from "@shared/pinterest";

const FEED = "https://widgets.pinterest.com/v3/pidgets";
const AGENT = "Mozilla/5.0 (compatible; studio-mood-board/1.0)";
/** How many pictures one go may add to a skill. The skill's text is written from its first ten. */
export const PIN_LIMIT = 24;

async function feed(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${FEED}${path}`, {
    headers: { "User-Agent": AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 404)
    throw new StudioError(
      "Pinterest has no public board at that link. Secret boards cannot be read; make the board public or copy its pins to a public one.",
      404,
    );
  if (!r.ok)
    throw new StudioError("Pinterest is not answering right now. Try again in a minute.", 502);
  return ((await r.json()) as { data?: Record<string, unknown> }).data ?? {};
}

/** The app's short links (pin.it) lead to the real page after a redirect or two. */
async function resolve(link: string): Promise<Exclude<PinterestTarget, { kind: "short" }>> {
  let target = parsePinterestLink(link);
  if (target?.kind === "short") {
    const r = await fetch(target.url, {
      headers: { "User-Agent": AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    await r.body?.cancel();
    target = parsePinterestLink(r.url);
  }
  if (!target || target.kind === "short")
    throw new StudioError(
      "That is not a Pinterest board or pin link. Open the board on Pinterest and copy its link.",
    );
  return target;
}

export async function pinterestPins(link: string): Promise<{ title: string; pins: Pin[] }> {
  const target = await resolve(link);
  if (target.kind === "user") {
    const data = await feed(`/users/${encodeURIComponent(target.user)}/pins/`);
    const pins = readPins(data.pins);
    if (!pins.length)
      throw new StudioError(
        "That Pinterest account has no public pictures the studio can read.",
        404,
      );
    const name = (data.user as { full_name?: unknown } | undefined)?.full_name;
    return {
      title:
        typeof name === "string" && name.trim() ? decodeEntities(name).slice(0, 60) : target.user,
      pins,
    };
  }
  if (target.kind === "pin") {
    const data = (await feed(`/pins/info/?pin_ids=${encodeURIComponent(target.id)}`)) as unknown;
    const pins = readPins(data);
    if (!pins.length)
      throw new StudioError("Pinterest did not return a picture for that pin.", 404);
    return { title: pins[0].note.split(/[.,|]/)[0].slice(0, 40) || "Pinterest pin", pins };
  }
  const data = await feed(
    `/boards/${encodeURIComponent(target.user)}/${encodeURIComponent(target.board)}/pins/`,
  );
  const pins = readPins(data.pins);
  if (!pins.length)
    throw new StudioError(
      "That board has no pictures the studio can read (videos are left out).",
      404,
    );
  const name = (data.board as { name?: unknown } | undefined)?.name;
  return {
    title: typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : target.board,
    pins,
  };
}

/** The mood boards an account shows on its public profile page. */
export async function accountBoards(user: string): Promise<string[]> {
  const r = await fetch(`https://www.pinterest.com/${encodeURIComponent(user)}/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    return [];
  }
  return profileBoards(await r.text(), user);
}

/** Pinterest sends names with HTML entities ("H&amp;M", "&#183; ZARA &#183;"). */
export function decodeEntities(v: string): string {
  return v
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PinPhoto {
  bytes: ArrayBuffer;
  mime: string;
  name: string;
}

export async function pinsByIds(ids: string[]): Promise<Pin[]> {
  const out: Pin[] = [];
  const unique = [...new Set(ids)].slice(0, 40);
  for (let i = 0; i < unique.length; i += 20) {
    const data = (await feed(
      `/pins/info/?pin_ids=${unique
        .slice(i, i + 20)
        .map(encodeURIComponent)
        .join(",")}`,
    )) as unknown;
    out.push(...readPins(data));
  }
  // Pinterest answers in its own order; the person's order is the one that counts.
  return unique.map((id) => out.find((p) => p.id === id)).filter((p): p is Pin => !!p);
}

/**
 * Downloads the chosen pins. Their pictures are looked up from Pinterest by id, so only
 * Pinterest's own image host is ever fetched, whatever the browser sent.
 */
export async function pinterestPhotos(chosen: string[]): Promise<PinPhoto[]> {
  const pins = (await pinsByIds(chosen)).slice(0, PIN_LIMIT);
  if (!pins.length) throw new StudioError("Choose at least one picture.");
  return downloadPins(pins);
}

/** Fetches pictures from Pinterest's image host. Anything that is not a still picture is left out. */
export async function downloadPins(
  pins: { id: string; image: string }[],
  size: "236x" | "736x" = "736x",
): Promise<PinPhoto[]> {
  const out: PinPhoto[] = [];
  for (const pin of pins.slice(0, 24)) {
    const url = pinImage(pin.image, size);
    if (!url) continue;
    const r = await fetch(url, {
      headers: { "User-Agent": AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    const mime = (r.headers.get("content-type") ?? "").split(";")[0];
    if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) {
      await r.body?.cancel();
      continue;
    }
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength < 2_000 || bytes.byteLength > 12 * 1024 * 1024) continue;
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    out.push({ bytes, mime, name: `pinterest-${pin.id}.${ext}` });
  }
  if (!out.length)
    throw new StudioError("None of those pictures could be downloaded from Pinterest.", 502);
  return out;
}
