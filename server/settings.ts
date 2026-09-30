/**
 * Encrypted server-side settings, used for the engine key when it is entered from the app
 * instead of being set as a Worker secret. Values are AES-GCM encrypted with a key derived
 * from SESSION_SECRET, so a database dump alone does not reveal them.
 */
import type { Env } from "./env";
import { StudioError } from "./errors";
import { first, run, now } from "./db";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function aesKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16)
    throw new StudioError("Server is missing SESSION_SECRET. Set it as a secret.", 503);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(`settings:${env.SESSION_SECRET}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(value)),
  );
  await run(
    env.DB,
    "INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
    key,
    `${b64(iv)}.${b64(cipher)}`,
    now(),
  );
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM settings WHERE key = ?",
    key,
  );
  if (!row) return null;
  const [iv, cipher] = row.value.split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await aesKey(env),
      unb64(cipher),
    );
    return dec.decode(plain);
  } catch {
    return null; // SESSION_SECRET changed; the setting must be entered again
  }
}

export async function deleteSetting(env: Env, key: string): Promise<void> {
  await run(env.DB, "DELETE FROM settings WHERE key = ?", key);
}

export const ENGINE_KEY_SETTING = "higgsfield_api_key";

export type EngineKeySource = "secret" | "stored" | "none";

/** The engine credential: a Worker secret wins, otherwise the key saved from the app. */
export async function resolveEngineKey(
  env: Env,
): Promise<{ key: string | null; source: EngineKeySource }> {
  if (env.HIGGSFIELD_API_KEY) return { key: env.HIGGSFIELD_API_KEY, source: "secret" };
  const stored = await getSetting(env, ENGINE_KEY_SETTING);
  return stored ? { key: stored, source: "stored" } : { key: null, source: "none" };
}

export const ENGINE_MODEL_SETTING = "higgsfield_model";

/**
 * The model slug: saved from the app when present; otherwise Nano Banana Pro through Google when a
 * Google key exists, else the HIGGSFIELD_MODEL variable.
 */
export async function resolveEngineModel(env: Env): Promise<string> {
  const stored = await getSetting(env, ENGINE_MODEL_SETTING);
  if (stored) return stored;
  if ((await resolveGoogleKey(env)).key) return "gemini-3-pro-image";
  return env.HIGGSFIELD_MODEL || "nano-banana-pro";
}

export const OPENAI_KEY_SETTING = "openai_api_key";

/** OpenAI credential: a Worker secret wins, otherwise the key saved from the app. */
export async function resolveOpenAIKey(
  env: Env,
): Promise<{ key: string | null; source: EngineKeySource }> {
  if (env.OPENAI_API_KEY) return { key: env.OPENAI_API_KEY, source: "secret" };
  const stored = await getSetting(env, OPENAI_KEY_SETTING);
  return stored ? { key: stored, source: "stored" } : { key: null, source: "none" };
}

export const GOOGLE_KEY_SETTING = "google_api_key";

/** Google AI Studio credential: the GEMINI_API_KEY secret wins, otherwise the key saved from the app. */
export async function resolveGoogleKey(
  env: Env,
): Promise<{ key: string | null; source: EngineKeySource }> {
  if (env.GEMINI_API_KEY) return { key: env.GEMINI_API_KEY, source: "secret" };
  const stored = await getSetting(env, GOOGLE_KEY_SETTING);
  return stored ? { key: stored, source: "stored" } : { key: null, source: "none" };
}
