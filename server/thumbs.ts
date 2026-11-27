/**
 * Small copies of stored images for grids and viewers. A result is a 2K PNG of several megabytes;
 * a page of them is hundreds. Each size is made once, kept beside the original (so it is deleted
 * with the batch) and served from storage after that.
 */
import type { Env } from "./env";
import { errorMessage } from "./errors";

/** The widths pages may ask for: batch rows, review grid, batch grid, viewer. */
export const THUMB_WIDTHS = [160, 480, 640, 1400] as const;

export function thumbWidth(raw: string | undefined): number | null {
  const w = Number(raw);
  return (THUMB_WIDTHS as readonly number[]).includes(w) ? w : null;
}

const thumbKey = (key: string, width: number) => `${key}.w${width}.webp`;

/** Makes and stores one small copy. Returns its bytes, or null when resizing is not available. */
export async function makeThumb(env: Env, key: string, width: number): Promise<ArrayBuffer | null> {
  if (!env.PHOTOS) return null;
  const original = await env.BUCKET.get(key);
  if (!original) return null;
  try {
    const out = await env.PHOTOS.input(original.body)
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: 82 });
    const bytes = await out.response().arrayBuffer();
    await env.BUCKET.put(thumbKey(key, width), bytes, {
      httpMetadata: { contentType: "image/webp" },
    });
    return bytes;
  } catch (e) {
    console.error("[thumb]", width, errorMessage(e));
    return null;
  }
}

/** The small copy as a response: from storage when it exists, made now when it does not. */
export async function thumbResponse(
  env: Env,
  key: string,
  width: number,
): Promise<Response | null> {
  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  const stored = await env.BUCKET.get(thumbKey(key, width));
  if (stored) return new Response(stored.body, { headers });
  const made = await makeThumb(env, key, width);
  return made ? new Response(made, { headers }) : null;
}
