/**
 * Video clips from finished images, rendered by Kling through the team's Higgsfield account.
 *
 * The studio signs in to Higgsfield's MCP server once (OAuth with PKCE, a public client), then
 * calls three of its tools: media_import_url (hand over the still), generate_video (submit) and
 * jobs_wait (poll). Finished clips are copied into the studio's own storage.
 */
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { all, first, now, run, uuid } from "./db";
import { deleteSetting, getSetting, setSetting } from "./settings";
import { signObjectUrl } from "./signed";
import {
  VIDEO_MODEL,
  clipCredits,
  clipPrompt,
  jobIdOf,
  jobStateOf,
  mediaIdOf,
  type Clip,
} from "@shared/video";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const AUTH_URL = "https://mcp.higgsfield.ai/oauth2/authorize";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
/** The studio's registration with Higgsfield: a public client id, not a secret. */
const DEFAULT_CLIENT_ID = "fPLSFIezJ4IhUXlJ";
const SCOPE = "openid email offline_access";
const TOKENS_SETTING = "hf_tokens";
const PENDING_SETTING = "hf_oauth_pending";
const MOTION_SETTING = "video_motion";

interface Tokens {
  access: string;
  refresh: string | null;
  expires: number;
}

const clientId = (env: Env) => env.HIGGSFIELD_CLIENT_ID || DEFAULT_CLIENT_ID;

function redirectUri(env: Env): string {
  if (!env.PUBLIC_BASE_URL) throw new StudioError("Server is missing PUBLIC_BASE_URL.", 503);
  return new URL("/api/video/callback", env.PUBLIC_BASE_URL).toString();
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Where to send the admin to sign in to Higgsfield. */
export async function videoConnectUrl(env: Env): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  await setSetting(env, PENDING_SETTING, JSON.stringify({ state, verifier, at: now() }));
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId(env));
  u.searchParams.set("redirect_uri", redirectUri(env));
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", MCP_URL);
  return u.toString();
}

async function tokenRequest(env: Env, form: Record<string, string>): Promise<Tokens> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...form, client_id: clientId(env) }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let d: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string } = {};
  try {
    d = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!r.ok || !d.access_token) {
    console.error("[video] token request failed", r.status, text.slice(0, 300));
    throw new StudioError("Higgsfield did not accept the sign-in. Connect video again.", 428);
  }
  return {
    access: d.access_token,
    refresh: d.refresh_token ?? form.refresh_token ?? null,
    expires: now() + Math.max(60, d.expires_in ?? 3600) * 1000,
  };
}

/** The sign-in coming back from Higgsfield. The state is single-use and expires in ten minutes. */
export async function videoCallback(env: Env, code: string, state: string): Promise<void> {
  const raw = await getSetting(env, PENDING_SETTING);
  const pending = raw ? (JSON.parse(raw) as { state: string; verifier: string; at: number }) : null;
  await deleteSetting(env, PENDING_SETTING);
  if (!pending || !code || pending.state !== state || now() - pending.at > 10 * 60_000)
    throw new StudioError("This sign-in link expired. Start again from the Video page.", 400);
  const tokens = await tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(env),
    code_verifier: pending.verifier,
    resource: MCP_URL,
  });
  await setSetting(env, TOKENS_SETTING, JSON.stringify(tokens));
}

export async function disconnectVideo(env: Env): Promise<void> {
  await deleteSetting(env, TOKENS_SETTING);
}

async function readTokens(env: Env): Promise<Tokens | null> {
  const raw = await getSetting(env, TOKENS_SETTING);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

export async function videoConnected(env: Env): Promise<boolean> {
  return !!(await readTokens(env));
}

async function accessToken(env: Env, force = false): Promise<string> {
  let t = await readTokens(env);
  if (!t) throw new StudioError("Video is not connected. Connect Higgsfield on the Video page.", 428);
  if (!force && t.expires - now() > 60_000) return t.access;
  if (!t.refresh) {
    if (!force) return t.access;
    throw new StudioError("Higgsfield sign-in expired. Connect video again.", 428);
  }
  try {
    t = await tokenRequest(env, {
      grant_type: "refresh_token",
      refresh_token: t.refresh,
      resource: MCP_URL,
    });
    await setSetting(env, TOKENS_SETTING, JSON.stringify(t));
    return t.access;
  } catch (e) {
    // Another invocation may have refreshed a moment ago and rotated the refresh token.
    const again = await readTokens(env);
    if (again && again.access !== t.access && again.expires - now() > 60_000) return again.access;
    throw e;
  }
}

interface RpcMessage {
  id?: number;
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { message?: string };
}

/** One conversation with the MCP server: initialise once, then call tools. */
class Mcp {
  private session: string | null = null;
  private ready = false;
  private seq = 0;
  constructor(private env: Env) {}

  private async post(body: Record<string, unknown>, retry = true): Promise<RpcMessage | null> {
    const token = await accessToken(this.env);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    if (this.ready) headers["MCP-Protocol-Version"] = "2025-06-18";
    const r = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status === 401 && retry) {
      await accessToken(this.env, true);
      return this.post(body, false);
    }
    const sid = r.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    const text = await r.text();
    if (!r.ok) {
      console.error("[video] mcp", body.method, r.status, text.slice(0, 300));
      if (r.status === 401)
        throw new StudioError("Higgsfield sign-in expired. Connect video again.", 428);
      throw new StudioError("Higgsfield is not answering right now. Try again in a minute.", 502);
    }
    if (!text.trim()) return null;
    const messages: RpcMessage[] = [];
    if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try {
          messages.push(JSON.parse(line.slice(5).trim()) as RpcMessage);
        } catch {
          /* keep-alive or partial line */
        }
      }
    } else {
      try {
        messages.push(JSON.parse(text) as RpcMessage);
      } catch {
        /* not JSON */
      }
    }
    return messages.find((m) => m.id === body.id) ?? messages[messages.length - 1] ?? null;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.ready) {
      await this.post({
        id: ++this.seq,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "max-fashion-studio", version: "1.0" },
        },
      });
      this.ready = true;
      await this.post({ method: "notifications/initialized" });
    }
    const m = await this.post({
      id: ++this.seq,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (!m) throw new StudioError("Higgsfield sent an empty answer. Try again.", 502);
    if (m.error) throw new StudioError(`Higgsfield: ${(m.error.message ?? "request failed").slice(0, 200)}`, 502);
    const text = (m.result?.content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    if (m.result?.isError) {
      console.error("[video] tool", name, text.slice(0, 300));
      throw new StudioError(`Higgsfield: ${text.slice(0, 200) || "the request was refused"}`, 502);
    }
    if (m.result?.structuredContent) return m.result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
}

let creditsCache: { at: number; value: number | null } = { at: 0, value: null };

/** The credits left on the connected Higgsfield account, or null when it cannot be read. */
export async function videoCredits(env: Env, fresh = false): Promise<number | null> {
  if (!fresh && now() - creditsCache.at < 60_000) return creditsCache.value;
  try {
    const d = (await new Mcp(env).call("balance", {})) as { credits?: number };
    creditsCache = { at: now(), value: typeof d.credits === "number" ? d.credits : null };
  } catch (e) {
    console.error("[video] balance", errorMessage(e));
    creditsCache = { at: now(), value: null };
  }
  return creditsCache.value;
}

const CLIP_COLUMNS =
  "id, batch, task, name, skill, status, seconds, ratio, motion, credits, error, created, updated";

export async function listClips(env: Env, owner: string): Promise<Clip[]> {
  return all<Clip>(
    env.DB,
    `SELECT ${CLIP_COLUMNS} FROM clips WHERE owner = ? ORDER BY created DESC LIMIT 200`,
    owner,
  );
}

/** The motion line last used with each skill, so the dialog opens on the team's own choice. */
export async function motionMemory(env: Env): Promise<Record<string, string>> {
  try {
    return JSON.parse((await getSetting(env, MOTION_SETTING)) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export interface ClipRequest {
  items: { batch: string; id: string }[];
  seconds: number;
  ratio: string;
  motion: string;
}

/** Records the clips to render. Nothing is sent to the engine here; submitClips does that. */
export async function queueClips(env: Env, owner: string, req: ClipRequest): Promise<number> {
  if (!(await videoConnected(env)))
    throw new StudioError("Video is not connected. Connect Higgsfield on the Video page.", 428);
  const memory = await motionMemory(env);
  let made = 0;
  for (const item of req.items) {
    const row = await first<{ output: string | null; name: string; skill: string | null }>(
      env.DB,
      `SELECT t.output, s.name, COALESCE(s.skill, json_extract(b.config, '$.skill')) AS skill
       FROM tasks t JOIN sources s ON s.id = t.source JOIN batches b ON b.id = t.batch
       WHERE t.id = ? AND t.batch = ? AND b.owner = ?`,
      item.id,
      item.batch,
      owner,
    );
    if (!row?.output) continue;
    const t = now();
    await run(
      env.DB,
      `INSERT INTO clips (id, owner, batch, task, name, skill, status, seconds, ratio, motion, credits, poster, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      uuid(),
      owner,
      item.batch,
      item.id,
      row.name,
      row.skill,
      req.seconds,
      req.ratio,
      req.motion,
      clipCredits(req.seconds),
      row.output,
      t,
      t,
    );
    if (row.skill) memory[row.skill] = req.motion;
    made++;
  }
  if (made) await setSetting(env, MOTION_SETTING, JSON.stringify(memory));
  return made;
}

interface ClipRow extends Clip {
  job: string | null;
  key: string | null;
  poster: string | null;
}

async function fail(env: Env, id: string, message: string): Promise<void> {
  await run(
    env.DB,
    "UPDATE clips SET status = 'failed', error = ?, updated = ? WHERE id = ?",
    message.slice(0, 300),
    now(),
    id,
  );
}

/**
 * Sends waiting clips to the engine. A clip is claimed first (queued -> rendering), so a clip is
 * never submitted twice even when the request and the schedule both get here. If a submission
 * is cut off its outcome is unknown, so it is failed for a person to redo rather than resent.
 */
export async function submitClips(env: Env, limit = 3): Promise<void> {
  const waiting = await all<ClipRow>(
    env.DB,
    "SELECT * FROM clips WHERE status = 'queued' ORDER BY created LIMIT ?",
    limit,
  );
  if (!waiting.length) return;
  const mcp = new Mcp(env);
  for (const clip of waiting) {
    const claimed = await run(
      env.DB,
      "UPDATE clips SET status = 'rendering', updated = ? WHERE id = ? AND status = 'queued'",
      now(),
      clip.id,
    );
    if (!claimed) continue;
    try {
      if (!clip.poster) throw new StudioError("The image is no longer stored.");
      const media = mediaIdOf(
        await mcp.call("media_import_url", {
          url: await signObjectUrl(env, clip.poster),
          type: "image",
        }),
      );
      if (!media) throw new StudioError("Higgsfield could not read the image.");
      const job = jobIdOf(
        await mcp.call("generate_video", {
          params: {
            model: VIDEO_MODEL,
            prompt: clipPrompt(clip.motion),
            duration: clip.seconds,
            aspect_ratio: clip.ratio,
            resolution: "720p",
            medias: [{ role: "start_image", value: media }],
            use_unlim: false,
          },
        }),
      );
      if (!job) throw new StudioError("Higgsfield did not start the clip.");
      await run(env.DB, "UPDATE clips SET job = ?, updated = ? WHERE id = ?", job, now(), clip.id);
    } catch (e) {
      console.error("[video] submit", clip.id, errorMessage(e));
      await fail(env, clip.id, e instanceof StudioError ? e.message : "Could not start this clip.");
    }
  }
  creditsCache.at = 0;
}

/** Collects finished clips into the studio's storage and marks the ones that failed. */
export async function collectClips(env: Env): Promise<void> {
  const t = now();
  // Claimed but never given a job id: the submission was cut off.
  await run(
    env.DB,
    "UPDATE clips SET status = 'failed', error = 'Could not start this clip. Use Redo to try again.', updated = ? WHERE status = 'rendering' AND job IS NULL AND updated < ?",
    t,
    t - 5 * 60_000,
  );
  await run(
    env.DB,
    "UPDATE clips SET status = 'failed', error = 'The clip took too long to render. Use Redo to try again.', updated = ? WHERE status = 'rendering' AND job IS NOT NULL AND updated < ?",
    t,
    t - 45 * 60_000,
  );
  const rendering = await all<ClipRow>(
    env.DB,
    "SELECT * FROM clips WHERE status = 'rendering' AND job IS NOT NULL ORDER BY created LIMIT 12",
  );
  if (!rendering.length) return;
  const data = await new Mcp(env).call("jobs_wait", {
    jobs: rendering.map((c, index) => ({ index, job_id: c.job })),
    timeout_seconds: 0,
  });
  for (const clip of rendering) {
    const state = jobStateOf(data, clip.job as string);
    if (state.state === "pending") continue;
    if (state.state === "failed") {
      await fail(env, clip.id, state.message);
      continue;
    }
    try {
      const r = await fetch(state.url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
      const key = `clips/${clip.id}.mp4`;
      await env.BUCKET.put(key, r.body, { httpMetadata: { contentType: "video/mp4" } });
      await run(
        env.DB,
        "UPDATE clips SET status = 'ready', key = ?, error = NULL, updated = ? WHERE id = ? AND status = 'rendering'",
        key,
        now(),
        clip.id,
      );
    } catch (e) {
      // The clip exists at the engine; the next pass tries the download again.
      console.error("[video] collect", clip.id, errorMessage(e));
    }
  }
}

/** One pass over the clips in flight. Cheap when there are none. */
export async function advanceClips(env: Env, submit = 3): Promise<void> {
  const active = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM clips WHERE status IN ('queued','rendering')",
  );
  if (!active?.n || !(await videoConnected(env))) return;
  await submitClips(env, submit);
  await collectClips(env);
}

async function ownedClip(env: Env, owner: string, id: string): Promise<ClipRow> {
  const clip = await first<ClipRow>(env.DB, "SELECT * FROM clips WHERE id = ? AND owner = ?", id, owner);
  if (!clip) throw new StudioError("Clip not found.", 404);
  return clip;
}

export async function approveClip(env: Env, owner: string, id: string): Promise<void> {
  await ownedClip(env, owner, id);
  await run(
    env.DB,
    "UPDATE clips SET status = 'approved', updated = ? WHERE id = ? AND status = 'ready'",
    now(),
    id,
  );
}

/** Renders the same image again with the same settings. This spends credits again. */
export async function redoClip(env: Env, owner: string, id: string): Promise<void> {
  const clip = await ownedClip(env, owner, id);
  if (clip.status === "queued" || clip.status === "rendering") return;
  if (clip.key) await env.BUCKET.delete(clip.key);
  await run(
    env.DB,
    "UPDATE clips SET status = 'queued', job = NULL, key = NULL, error = NULL, updated = ? WHERE id = ?",
    now(),
    id,
  );
}

export async function deleteClip(env: Env, owner: string, id: string): Promise<void> {
  const clip = await ownedClip(env, owner, id);
  if (clip.key) await env.BUCKET.delete(clip.key);
  await run(env.DB, "DELETE FROM clips WHERE id = ?", id);
}

/** Streams a clip (with Range, which Safari needs to play video) or its starting still. */
export async function clipFile(
  env: Env,
  owner: string,
  id: string,
  kind: "video" | "poster",
  range: string | undefined,
  download: boolean,
): Promise<Response> {
  const clip = await ownedClip(env, owner, id);
  const key = kind === "poster" ? clip.poster : clip.key;
  if (!key) throw new StudioError("Not ready yet.", 404);
  if (kind === "poster") {
    const obj = await env.BUCKET.get(key);
    if (!obj) throw new StudioError("Image not found.", 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  const head = await env.BUCKET.head(key);
  if (!head) throw new StudioError("Clip not found.", 404);
  const size = head.size;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (download)
    headers["Content-Disposition"] =
      `attachment; filename="${clip.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_")}.mp4"`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const part = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!part) throw new StudioError("Clip not found.", 404);
    return new Response(part.body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  const obj = await env.BUCKET.get(key);
  if (!obj) throw new StudioError("Clip not found.", 404);
  return new Response(obj.body, { headers: { ...headers, "Content-Length": String(size) } });
}
