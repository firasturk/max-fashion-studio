import type { Env } from "./env";
import { StudioError } from "./errors";

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(env: Env, value: string): Promise<string> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16)
    throw new StudioError("Server is missing SESSION_SECRET. Set it as a secret.", 503);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`objects:${env.SESSION_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

/**
 * A short-lived public URL for one R2 object, for engines that fetch their inputs by URL
 * (fal.ai). Sending a URL instead of a base64 copy keeps multi-megabyte results out of the
 * Worker's memory and off the request body.
 */
export async function signObjectUrl(
  env: Env,
  key: string,
  ttlMs = 2 * 60 * 60 * 1000,
): Promise<string> {
  if (!env.PUBLIC_BASE_URL)
    throw new StudioError("Server is missing PUBLIC_BASE_URL (needed for fal.ai inputs).", 503);
  const exp = String(Date.now() + ttlMs);
  const sig = await sign(env, `${key}:${exp}`);
  const u = new URL("/api/public/object", env.PUBLIC_BASE_URL);
  u.searchParams.set("k", key);
  u.searchParams.set("e", exp);
  u.searchParams.set("s", sig);
  return u.toString();
}

export async function verifyObjectToken(
  env: Env,
  key: string,
  exp: string,
  sig: string,
): Promise<boolean> {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = await sign(env, `${key}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
