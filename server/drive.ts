/**
 * Google Drive inbox. The studio's Google service account reads a folder the team shares with
 * it; every delivery folder inside waits in the inbox until someone approves it, and approval
 * copies its photos into a batch. Nothing is generated before that approval.
 */
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { all, first, now, run, uuid } from "./db";
import { getSetting, resolveEngineModel, resolveVertex, setSetting } from "./settings";
import { DRIVE_SCOPE, vertexToken, type VertexCreds } from "./vertex";
import { insertSource } from "./sources";
import { DEFAULT_CONFIG, validateConfig, type Config } from "@shared/config";
import { stemKey, isValidSourceName } from "@shared/naming";
import {
  guessSkill,
  importName,
  isDeliveryName,
  learnRule,
  type DriveRules,
  type SkillGuess,
} from "@shared/drive";

export const DRIVE_INBOX_SETTING = "drive_inbox";
const DRIVE_RULES_SETTING = "drive_rules";
const DRIVE_SYNC_SETTING = "drive_last_sync";
const DRIVE_ERROR_SETTING = "drive_error";
const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO = 12 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_DEPTH = 3;
/** One import run stays well inside the runner's wall time; a longer folder continues in the next run. */
const IMPORT_BUDGET_MS = 8 * 60 * 1000;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  thumbnailLink?: string;
}

export interface DriveFolderRow {
  id: string;
  name: string;
  path: string;
  files: number;
  bytes: number;
  modified: number;
  thumbs: string;
  state: "waiting" | "importing" | "imported" | "failed" | "skipped" | "gone";
  batch: string | null;
  imported: number;
  skipped: number;
  error: string | null;
  seen: number;
  updated: number;
}

export interface ImportJob {
  kind: "import";
  folder: string;
  batch: string;
  start: boolean;
}

export interface DriveInbox {
  id: string;
  name: string;
}

/** What Google says, in words the person connecting the folder can act on. */
async function driveError(r: Response, creds: VertexCreds): Promise<StudioError> {
  const text = (await r.text()).slice(0, 400);
  if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text))
    return new StudioError(
      "The Google Drive API is switched off for the studio's Google Cloud project. Turn it on (step 1 on this page), wait a minute and try again.",
      428,
    );
  if (r.status === 404 || r.status === 403)
    return new StudioError(
      `The studio cannot open that folder. Share it with ${creds.clientEmail} (Viewer is enough to read) and try again.`,
      404,
    );
  return new StudioError(`Google Drive answered ${r.status}: ${text}`, 502);
}

async function driveGet(
  creds: VertexCreds,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = await vertexToken(creds, fetchImpl, DRIVE_SCOPE);
  const r = await fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw await driveError(r, creds);
  return r;
}

/** Everything directly inside the given folders (asked for in groups, following pagination). */
export async function listChildren(
  creds: VertexCreds,
  parents: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  for (let i = 0; i < parents.length; i += 20) {
    const group = parents.slice(i, i + 20);
    const q = `(${group.map((p) => `'${p.replace(/'/g, "")}' in parents`).join(" or ")}) and trashed = false`;
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        orderBy: "name",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const d = (await (await driveGet(creds, `/files?${params}`, fetchImpl)).json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      out.push(...(d.files ?? []));
      pageToken = d.nextPageToken ?? "";
    } while (pageToken && out.length < MAX_FILES * 2);
  }
  return out;
}

export interface Delivery {
  id: string;
  name: string;
  path: string;
}

/**
 * Delivery folders under the inbox: date-named folders at the top, date-named folders one level
 * down inside a category folder ("Women / 28-10-2026-WW Denim-14"), and any other top folder
 * that is not a category.
 */
export async function findDeliveries(
  creds: VertexCreds,
  rootId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Delivery[]> {
  const top = (await listChildren(creds, [rootId], fetchImpl)).filter((f) => f.mimeType === FOLDER);
  const out: Delivery[] = top
    .filter((f) => isDeliveryName(f.name))
    .map((f) => ({ id: f.id, name: f.name.trim(), path: "" }));
  const others = top.filter((f) => !isDeliveryName(f.name));
  if (others.length) {
    const inner = (await listChildren(creds, others.map((f) => f.id), fetchImpl)).filter(
      (f) => f.mimeType === FOLDER,
    );
    for (const o of others) {
      const dated = inner.filter((f) => f.parents?.includes(o.id) && isDeliveryName(f.name));
      if (dated.length)
        out.push(...dated.map((f) => ({ id: f.id, name: f.name.trim(), path: o.name.trim() })));
      else out.push({ id: o.id, name: o.name.trim(), path: "" });
    }
  }
  return out;
}

export interface DeliveryPhoto extends DriveFile {
  /** Path inside the delivery, folders included: "170023817/170023817_01.jpg". */
  relative: string;
}

/** Every photo in a delivery, up to three folders deep. */
export async function scanDelivery(
  creds: VertexCreds,
  folderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryPhoto[]> {
  const photos: DeliveryPhoto[] = [];
  let level: { id: string; path: string }[] = [{ id: folderId, path: "" }];
  for (let depth = 0; depth <= MAX_DEPTH && level.length && photos.length < MAX_FILES; depth++) {
    const paths = new Map(level.map((l) => [l.id, l.path]));
    const children = await listChildren(creds, level.map((l) => l.id), fetchImpl);
    const next: { id: string; path: string }[] = [];
    for (const f of children) {
      const parent = f.parents?.find((p) => paths.has(p));
      if (parent === undefined) continue;
      const rel = `${paths.get(parent)}${f.name.trim()}`;
      if (f.mimeType === FOLDER) next.push({ id: f.id, path: `${rel}/` });
      else if (f.mimeType.startsWith("image/")) photos.push({ ...f, relative: rel });
    }
    level = next;
  }
  return photos
    .sort((a, b) => a.relative.localeCompare(b.relative, undefined, { numeric: true }))
    .slice(0, MAX_FILES);
}

export async function driveInbox(env: Env): Promise<DriveInbox | null> {
  const raw = await getSetting(env, DRIVE_INBOX_SETTING);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveInbox;
  } catch {
    return null;
  }
}

/** Checks the folder can be opened and remembers it as the inbox. */
export async function connectInbox(env: Env, folderId: string): Promise<DriveInbox> {
  const creds = await resolveVertex(env);
  if (!creds)
    throw new StudioError("Connect the Google Cloud service account first (Connection).", 428);
  const params = new URLSearchParams({ fields: "id,name,mimeType", supportsAllDrives: "true" });
  const f = (await (await driveGet(creds, `/files/${encodeURIComponent(folderId)}?${params}`)).json()) as DriveFile;
  if (f.mimeType !== FOLDER) throw new StudioError("That link is a file. Paste the link of a folder.");
  const inbox = { id: f.id, name: f.name };
  await setSetting(env, DRIVE_INBOX_SETTING, JSON.stringify(inbox));
  await setSetting(env, DRIVE_SYNC_SETTING, "0");
  return inbox;
}

const DRIVE_API_SETTING = "drive_api";
export type DriveApiState = "on" | "off" | "unknown";

/**
 * Makes sure the Drive API is switched on in the studio's own Google Cloud project. It asks Drive
 * first; when Drive says the API is off it tries to switch it on with the service account, which
 * works when that account may manage services. If it may not, the Inbox shows the manual step.
 */
export async function ensureDriveApi(env: Env, force = false): Promise<DriveApiState> {
  const creds = await resolveVertex(env);
  if (!creds) return "unknown";
  const saved = JSON.parse((await getSetting(env, DRIVE_API_SETTING)) || "{}") as {
    state?: DriveApiState;
    at?: number;
    project?: string;
  };
  if (saved.project === creds.projectId) {
    if (saved.state === "on") return "on";
    if (!force && saved.at && now() - saved.at < 10 * 60_000) return saved.state ?? "unknown";
  }
  let state: DriveApiState = "unknown";
  try {
    const token = await vertexToken(creds, fetch, DRIVE_SCOPE);
    const r = await fetch(`${API}/about?fields=kind`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const text = r.ok ? "" : (await r.text()).slice(0, 300);
    if (r.ok) state = "on";
    else if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
      state = "off";
      const cloud = await vertexToken(creds);
      const e = await fetch(
        `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/services/drive.googleapis.com:enable`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cloud}`, "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(30_000),
        },
      );
      console.log("[drive] switching the Drive API on:", e.status, e.ok ? "accepted" : (await e.text()).slice(0, 200));
    } else console.log("[drive] api check", r.status, text);
  } catch (e) {
    console.log("[drive] api check failed", e instanceof Error ? e.message : e);
  }
  await setSetting(env, DRIVE_API_SETTING, JSON.stringify({ state, at: now(), project: creds.projectId }));
  return state;
}

export async function driveStatus(env: Env): Promise<{
  account: string | null;
  inbox: DriveInbox | null;
  lastSync: number;
  error: string | null;
  api: DriveApiState;
  /** The Google Cloud project the service account lives in: where the Drive API is switched on. */
  project: string | null;
}> {
  const creds = await resolveVertex(env);
  const inbox = await driveInbox(env);
  return {
    account: creds?.clientEmail ?? null,
    inbox,
    lastSync: Number((await getSetting(env, DRIVE_SYNC_SETTING)) ?? 0),
    error: (await getSetting(env, DRIVE_ERROR_SETTING)) || null,
    api: inbox ? "on" : await ensureDriveApi(env).catch(() => "unknown" as const),
    project: creds?.projectId ?? null,
  };
}

/**
 * Looks at the inbox folder and records what is waiting. Folders already imported or skipped are
 * left alone; waiting ones are counted again, since photos may still be arriving.
 */
export async function syncDrive(env: Env, force = false): Promise<void> {
  const inbox = await driveInbox(env);
  const creds = inbox ? await resolveVertex(env) : null;
  if (!inbox || !creds) return;
  const last = Number((await getSetting(env, DRIVE_SYNC_SETTING)) ?? 0);
  if (!force && now() - last < 55_000) return;
  await setSetting(env, DRIVE_SYNC_SETTING, String(now()));
  try {
    const deliveries = await findDeliveries(creds, inbox.id);
    const rows = await all<DriveFolderRow>(env.DB, "SELECT * FROM drive_folders");
    const known = new Map(rows.map((r) => [r.id, r]));
    let scans = 0;
    for (const d of deliveries) {
      const row = known.get(d.id);
      if (row && row.state !== "waiting" && row.state !== "gone") continue;
      if (scans >= 12) break;
      scans++;
      const photos = await scanDelivery(creds, d.id);
      const bytes = photos.reduce((n, p) => n + Number(p.size ?? 0), 0);
      const modified = photos.reduce((n, p) => Math.max(n, Date.parse(p.modifiedTime ?? "") || 0), 0);
      const thumbs = JSON.stringify(photos.slice(0, 4).map((p) => p.id));
      await run(
        env.DB,
        "INSERT INTO drive_folders (id, name, path, files, bytes, modified, thumbs, state, seen, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, files = excluded.files, bytes = excluded.bytes, modified = excluded.modified, thumbs = excluded.thumbs, state = 'waiting', seen = excluded.seen, updated = excluded.updated",
        d.id,
        d.name,
        d.path,
        photos.length,
        bytes,
        modified,
        thumbs,
        now(),
        now(),
      );
    }
    const present = new Set(deliveries.map((d) => d.id));
    for (const r of rows)
      if (r.state === "waiting" && !present.has(r.id))
        await run(env.DB, "UPDATE drive_folders SET state = 'gone', updated = ? WHERE id = ?", now(), r.id);
    await setSetting(env, DRIVE_ERROR_SETTING, "");
  } catch (e) {
    await setSetting(env, DRIVE_ERROR_SETTING, errorMessage(e).slice(0, 400));
    throw e;
  }
}

/** The folder-to-skill memory; the first time, it is read from the batches the team already ran. */
export async function driveRules(env: Env): Promise<DriveRules> {
  const raw = await getSetting(env, DRIVE_RULES_SETTING);
  if (raw) {
    try {
      return JSON.parse(raw) as DriveRules;
    } catch {
      /* rebuilt below */
    }
  }
  const past = await all<{ seg: string; skill: string | null; n: number }>(
    env.DB,
    "SELECT trim(substr(s.name, 1, instr(s.name, '/') - 1)) AS seg, COALESCE(s.skill, json_extract(b.config, '$.skill')) AS skill, COUNT(*) AS n FROM sources s JOIN batches b ON b.id = s.batch WHERE instr(s.name, '/') > 0 GROUP BY seg, skill",
  );
  let rules: DriveRules = {};
  for (const p of past)
    if (p.skill && isDeliveryName(p.seg)) rules = learnRule(rules, p.seg, p.skill);
  const named = await all<{ name: string; skill: string | null }>(
    env.DB,
    "SELECT name, json_extract(config, '$.skill') AS skill FROM batches",
  );
  for (const b of named)
    if (b.skill && isDeliveryName(b.name)) rules = learnRule(rules, b.name, b.skill);
  await setSetting(env, DRIVE_RULES_SETTING, JSON.stringify(rules));
  return rules;
}

export interface InboxFolder extends Omit<DriveFolderRow, "thumbs"> {
  thumbs: string[];
  guess: SkillGuess;
}

export async function inboxFolders(env: Env): Promise<InboxFolder[]> {
  const rows = await all<DriveFolderRow>(
    env.DB,
    "SELECT * FROM drive_folders WHERE state IN ('waiting','importing','failed') OR (state = 'imported' AND updated > ?) ORDER BY CASE state WHEN 'importing' THEN 0 WHEN 'failed' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, modified DESC LIMIT 60",
    now() - 24 * 3600 * 1000,
  );
  const rules = await driveRules(env);
  return rows.map((r) => ({
    ...r,
    thumbs: JSON.parse(r.thumbs || "[]") as string[],
    guess: guessSkill(r.name, rules),
  }));
}

/** The settings a delivery starts with: the last batch that used this skill, else the defaults. */
async function configFor(env: Env, userId: string, skill: string): Promise<Config> {
  const same = await first<{ config: string }>(
    env.DB,
    "SELECT config FROM batches WHERE json_extract(config, '$.skill') = ? AND json_extract(config, '$.mode') IN ('5','7','8') ORDER BY created DESC LIMIT 1",
    skill,
  );
  const mine = same
    ? null
    : await first<{ config: string }>(
        env.DB,
        "SELECT config FROM batches WHERE owner = ? AND json_extract(config, '$.mode') IN ('5','7','8') ORDER BY created DESC LIMIT 1",
        userId,
      );
  const base = (same ?? mine) ? (JSON.parse((same ?? mine)!.config) as Config) : ({ ...DEFAULT_CONFIG, mode: "7" } as Config);
  const config: Config = { ...base, skill, identity: undefined };
  if (!config.model) config.model = await resolveEngineModel(env);
  const problem = validateConfig(config);
  if (problem) throw new StudioError(problem);
  return config;
}

async function dispatchImport(env: Env, job: ImportJob): Promise<void> {
  if (!env.RUNNER) throw new StudioError("The import runner is not available on this deployment.", 500);
  const stub = env.RUNNER.get(env.RUNNER.idFromName(`import:${job.folder}:${uuid()}`));
  const r = await stub.fetch("https://runner/run", { method: "POST", body: JSON.stringify(job) });
  if (!r.ok) throw new StudioError(`The import did not start (${r.status}).`, 502);
}

/** The approval: a batch is made for the folder and its photos start copying in the background. */
export async function approveFolder(
  env: Env,
  userId: string,
  folderId: string,
  skill: string,
  start: boolean,
): Promise<string> {
  const row = await first<DriveFolderRow>(env.DB, "SELECT * FROM drive_folders WHERE id = ?", folderId);
  if (!row) throw new StudioError("That folder is no longer in the inbox.", 404);
  if (row.state === "importing") throw new StudioError("This folder is already being imported.", 409);
  if (row.state === "imported") throw new StudioError("This folder was already imported.", 409);
  if (!row.files) throw new StudioError("This folder has no photos yet.");
  let batchId = row.batch;
  if (batchId && !(await first(env.DB, "SELECT id FROM batches WHERE id = ?", batchId))) batchId = null;
  if (!batchId) {
    const config = await configFor(env, userId, skill);
    batchId = uuid();
    await run(
      env.DB,
      "INSERT INTO batches (id, owner, name, config, state, created, updated) VALUES (?, ?, ?, ?, 'idle', ?, ?)",
      batchId,
      userId,
      row.name.slice(0, 100),
      JSON.stringify(config),
      now(),
      now(),
    );
    await setSetting(
      env,
      DRIVE_RULES_SETTING,
      JSON.stringify(learnRule(await driveRules(env), row.name, skill)),
    );
  }
  const claimed = await run(
    env.DB,
    "UPDATE drive_folders SET state = 'importing', batch = ?, error = NULL, updated = ? WHERE id = ? AND state IN ('waiting','failed','gone','skipped')",
    batchId,
    now(),
    folderId,
  );
  if (!claimed) throw new StudioError("This folder is already being imported.", 409);
  try {
    await dispatchImport(env, { kind: "import", folder: folderId, batch: batchId, start });
  } catch (e) {
    await run(
      env.DB,
      "UPDATE drive_folders SET state = 'failed', error = ?, updated = ? WHERE id = ?",
      errorMessage(e).slice(0, 300),
      now(),
      folderId,
    );
    throw e;
  }
  return batchId;
}

export async function skipFolder(env: Env, folderId: string): Promise<void> {
  await run(
    env.DB,
    "UPDATE drive_folders SET state = 'skipped', updated = ? WHERE id = ? AND state IN ('waiting','failed')",
    now(),
    folderId,
  );
}

/** A 1600 px copy from Drive's own preview, used as the engine reference when Drive has one. */
async function referenceCopy(
  creds: VertexCreds,
  fileId: string,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  try {
    const meta = (await (
      await driveGet(creds, `/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`)
    ).json()) as DriveFile;
    if (!meta.thumbnailLink) return null;
    const url = meta.thumbnailLink.replace(/=s\d+(-[a-z0-9-]+)?$/i, "=s1600");
    const token = await vertexToken(creds, fetch, DRIVE_SCOPE);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    const mime = r.headers.get("content-type")?.split(";")[0] ?? "";
    if (!r.ok || !IMAGE_TYPES.includes(mime)) return null;
    const bytes = await r.arrayBuffer();
    return bytes.byteLength > 20_000 && bytes.byteLength <= 3 * 1024 * 1024 ? { bytes, mime } : null;
  } catch {
    return null;
  }
}

/**
 * Copies a delivery's photos into its batch. Safe to run again: photos already in the batch are
 * skipped, so a long folder continues where it stopped. Returns true when more remains.
 */
export async function importFolder(env: Env, job: ImportJob): Promise<boolean> {
  const started = now();
  const fail = (message: string) =>
    run(
      env.DB,
      "UPDATE drive_folders SET state = 'failed', error = ?, updated = ? WHERE id = ?",
      message.slice(0, 300),
      now(),
      job.folder,
    );
  try {
    const row = await first<DriveFolderRow>(env.DB, "SELECT * FROM drive_folders WHERE id = ?", job.folder);
    const batch = await first<{ id: string; owner: string; config: string }>(
      env.DB,
      "SELECT id, owner, config FROM batches WHERE id = ?",
      job.batch,
    );
    const creds = await resolveVertex(env);
    if (!row || row.state !== "importing") return false;
    if (!batch) return void (await fail("The batch for this folder was deleted.")), false;
    if (!creds) return void (await fail("The Google Cloud service account is no longer connected.")), false;
    const config = JSON.parse(batch.config) as Config;
    const photos = await scanDelivery(creds, job.folder);
    const have = new Set(
      (await all<{ stem: string }>(env.DB, "SELECT stem FROM sources WHERE batch = ?", batch.id)).map((s) => s.stem),
    );
    let imported = have.size;
    let skipped = 0;
    const todo: { photo: (typeof photos)[number]; name: string; stem: string }[] = [];
    for (const photo of photos) {
      const name = importName(row.name, photo.relative);
      const stem = stemKey(name);
      if (have.has(stem)) continue;
      if (!IMAGE_TYPES.includes(photo.mimeType) || Number(photo.size ?? 0) > MAX_PHOTO || !isValidSourceName(name)) {
        skipped++;
        continue;
      }
      have.add(stem);
      todo.push({ photo, name, stem });
    }
    let cursor = 0;
    let out = false;
    const worker = async () => {
      while (cursor < todo.length) {
        if (now() - started > IMPORT_BUDGET_MS) return void (out = true);
        const { photo, name, stem } = todo[cursor++];
        const id = uuid();
        const key = `${batch.owner}/${batch.id}/source/${id}`;
        const media = await driveGet(creds, `/files/${encodeURIComponent(photo.id)}?alt=media&supportsAllDrives=true`);
        const bytes = await media.arrayBuffer();
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: photo.mimeType } });
        const ref = await referenceCopy(creds, photo.id);
        const referenceKey = ref ? `${key}.reference` : null;
        if (ref) await env.BUCKET.put(referenceKey!, ref.bytes, { httpMetadata: { contentType: ref.mime } });
        try {
          await insertSource(env, config, {
            id,
            batch: batch.id,
            name,
            stem,
            key,
            referenceKey,
            mime: photo.mimeType,
            size: bytes.byteLength,
            role: "lead",
          });
        } catch (e) {
          await env.BUCKET.delete([key, ...(referenceKey ? [referenceKey] : [])]);
          throw e;
        }
        imported++;
        await run(
          env.DB,
          "UPDATE drive_folders SET imported = ?, skipped = ?, updated = ? WHERE id = ?",
          imported,
          skipped,
          now(),
          job.folder,
        );
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (out) return true;
    await run(
      env.DB,
      "UPDATE drive_folders SET state = 'imported', imported = ?, skipped = ?, error = NULL, updated = ? WHERE id = ?",
      imported,
      skipped,
      now(),
      job.folder,
    );
    await run(env.DB, "UPDATE batches SET updated = ? WHERE id = ?", now(), batch.id);
    if (job.start && imported > 0)
      await run(
        env.DB,
        "UPDATE batches SET state = 'running', last_error = NULL, updated = ? WHERE id = ? AND state = 'idle'",
        now(),
        batch.id,
      );
    return false;
  } catch (e) {
    console.error("[drive import]", job.folder, errorMessage(e));
    await fail(errorMessage(e));
    return false;
  }
}

/** A small preview of one photo, only for photos the inbox itself lists. */
export async function driveThumb(env: Env, fileId: string): Promise<Response> {
  const listed = await first(
    env.DB,
    "SELECT id FROM drive_folders WHERE instr(thumbs, ?) > 0 LIMIT 1",
    `"${fileId}"`,
  );
  const creds = await resolveVertex(env);
  if (!listed || !creds) return new Response(null, { status: 404 });
  const meta = (await (
    await driveGet(creds, `/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`)
  ).json()) as DriveFile;
  if (!meta.thumbnailLink) return new Response(null, { status: 404 });
  const token = await vertexToken(creds, fetch, DRIVE_SCOPE);
  const r = await fetch(meta.thumbnailLink.replace(/=s\d+(-[a-z0-9-]+)?$/i, "=s240"), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return new Response(null, { status: 404 });
  return new Response(r.body, {
    headers: {
      "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
