/**
 * Google Drive inbox. The studio's Google service account reads a folder the team shares with
 * it; every delivery folder inside waits in the inbox until someone approves it, and approval
 * copies its photos into a batch. Nothing is generated before that approval.
 */
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { all, first, now, run, uuid } from "./db";
import { deleteSetting, getSetting, resolveEngineModel, setSetting } from "./settings";
import { insertSource } from "./sources";
import { signValue } from "./signed";
import { DEFAULT_CONFIG, validateConfig, type Config } from "@shared/config";
import { stemKey, isValidSourceName } from "@shared/naming";
import {
  classifyFolder,
  guessSkill,
  importName,
  isDeliveryName,
  isTagPhoto,
  learnRule,
  pickProductPhotos,
  plannedPhotos,
  tidyPlan,
  viewNumber,
  type FolderPlan,
  type DriveRules,
  type SkillGuess,
} from "@shared/drive";

export const DRIVE_INBOX_SETTING = "drive_inbox";
const DRIVE_RULES_SETTING = "drive_rules";
const DRIVE_SYNC_SETTING = "drive_last_sync";
const DRIVE_ERROR_SETTING = "drive_error";
const DRIVE_API_SETTING = "drive_api";
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
  /** "group" is a folder on the way down (a month, a day, a department); it is never shown. */
  state: "waiting" | "importing" | "imported" | "failed" | "skipped" | "gone" | "group";
  batch: string | null;
  imported: number;
  skipped: number;
  error: string | null;
  seen: number;
  updated: number;
  parent: string | null;
  products: number;
  walked: number;
  scanned: number;
  /** A person's choices for this delivery, as JSON (see FolderPlan); null when there are none. */
  plan?: string | null;
  /** What the client's tracker says: "delivered", "working", or null when it is not listed. */
  tracker_state?: string | null;
  tracker_info?: string | null;
}

/** The tracker line behind a folder's state. */
export interface TrackerInfo {
  state: "delivered" | "working";
  line: string;
  received: string;
  sent: string;
  upload: string;
  published: string;
}

/** The choices saved on a delivery. */
export function planOf(row: { plan?: string | null }): FolderPlan {
  if (!row.plan) return {};
  try {
    return JSON.parse(row.plan) as FolderPlan;
  } catch {
    return {};
  }
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
  /** The shared drive the folder lives in ("" for My Drive); looked up once. */
  driveId?: string;
}

/** What Google says, in words the person connecting the folder can act on. */
async function driveError(r: Response, creds: DriveAuth): Promise<StudioError> {
  const text = (await r.text()).slice(0, 400);
  if (
    r.status === 403 &&
    /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)
  )
    return new StudioError(
      "The Google Drive API is switched off in the Google Cloud project. Turn it on (step 2 on this page), wait a minute and try again.",
      428,
    );
  if (r.status === 404 || r.status === 403)
    return new StudioError(
      `${creds.email} cannot open that folder. Open the link while signed in as that account to check, then try again.`,
      404,
    );
  return new StudioError(`Google Drive answered ${r.status}: ${text}`, 502);
}

export async function driveGet(
  creds: DriveAuth,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = await creds.token();
  const r = await fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw await driveError(r, creds);
  return r;
}

/** Shared drives this account turned out not to be a member of: asked the ordinary way instead. */
const closedDrives = new Set<string>();

/**
 * Everything directly inside the given folders (asked for in groups, following pagination).
 * A folder in a shared drive is asked for through that drive: asked the ordinary way, Google
 * only returns the files this account has already opened, which leaves most of a delivery out.
 */
export async function listChildren(
  creds: DriveAuth,
  parents: string[],
  fetchImpl: typeof fetch = fetch,
  driveId = "",
): Promise<DriveFile[]> {
  if (driveId && !closedDrives.has(driveId)) {
    try {
      return await listIn(creds, parents, fetchImpl, driveId);
    } catch (e) {
      closedDrives.add(driveId);
      console.log("[drive] cannot list through the shared drive:", errorMessage(e).slice(0, 160));
    }
  }
  return listIn(creds, parents, fetchImpl, "");
}

async function listIn(
  creds: DriveAuth,
  parents: string[],
  fetchImpl: typeof fetch,
  driveId: string,
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
      if (driveId) {
        params.set("corpora", "drive");
        params.set("driveId", driveId);
      }
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

export interface DeliveryPhoto extends DriveFile {
  /** Path inside the delivery, folders included: "170023817/170023817_01.jpg". */
  relative: string;
}

/** Every photo in a delivery, up to three folders deep. */
export async function scanDelivery(
  creds: DriveAuth,
  folderId: string,
  fetchImpl: typeof fetch = fetch,
  driveId = "",
): Promise<DeliveryPhoto[]> {
  const photos: DeliveryPhoto[] = [];
  let level: { id: string; path: string }[] = [{ id: folderId, path: "" }];
  for (let depth = 0; depth <= MAX_DEPTH && level.length && photos.length < MAX_FILES; depth++) {
    const paths = new Map(level.map((l) => [l.id, l.path]));
    const children = await listChildren(
      creds,
      level.map((l) => l.id),
      fetchImpl,
      driveId,
    );
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
  const creds = await resolveDriveAuth(env);
  if (!creds) throw new StudioError("Sign in with Google first (step 3 on this page).", 428);
  const params = new URLSearchParams({
    fields: "id,name,mimeType,driveId",
    supportsAllDrives: "true",
  });
  const f = (await (
    await driveGet(creds, `/files/${encodeURIComponent(folderId)}?${params}`)
  ).json()) as DriveFile & { driveId?: string };
  if (f.mimeType !== FOLDER)
    throw new StudioError("That link is a file. Paste the link of a folder.");
  const inbox: DriveInbox = { id: f.id, name: f.name, driveId: f.driveId ?? "" };
  const before = await driveInbox(env);
  // Another folder: what was only waiting in the old one is forgotten; imported work stays.
  if (before && before.id !== inbox.id)
    await run(env.DB, "DELETE FROM drive_folders WHERE state IN ('waiting','group','gone')");
  await setSetting(env, DRIVE_INBOX_SETTING, JSON.stringify(inbox));
  await setSetting(env, DRIVE_SYNC_SETTING, "0");
  return inbox;
}

const HOME_SETTING = "drive_home";
const HOME_FOLDER = "Max Fashion Studio";
const HOME_INBOX = "1 - Inbox";
const HOME_APPROVED = "2 - Approved";

/** The folder with this name under a parent ("root" is My Drive), created when it is not there. */
async function findOrCreateFolder(creds: DriveAuth, name: string, parent: string): Promise<string> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and '${parent}' in parents and trashed = false`;
  const found = (await (
    await driveGet(
      creds,
      `/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`,
    )
  ).json()) as { files?: { id: string }[] };
  if (found.files?.[0]) return found.files[0].id;
  const r = await fetch(`${API}/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await creds.token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw await driveError(r, creds);
  return ((await r.json()) as { id: string }).id;
}

/**
 * Makes the studio's own folders in the signed-in account's Drive and connects the inbox:
 * "Max Fashion Studio / 1 - Inbox" for deliveries and "2 - Approved" for results. Folders that
 * already exist are reused, so asking twice never makes a second set.
 */
export async function createStudioFolders(env: Env): Promise<DriveInbox> {
  const creds = await resolveDriveAuth(env);
  if (!creds) throw new StudioError("Sign in with Google first (step 3 on this page).", 428);
  const root = await findOrCreateFolder(creds, HOME_FOLDER, "root");
  const inboxId = await findOrCreateFolder(creds, HOME_INBOX, root);
  const approved = await findOrCreateFolder(creds, HOME_APPROVED, root);
  await setSetting(env, HOME_SETTING, JSON.stringify({ root, inbox: inboxId, approved }));
  const inbox = { id: inboxId, name: `${HOME_FOLDER} / ${HOME_INBOX}` };
  await setSetting(env, DRIVE_INBOX_SETTING, JSON.stringify(inbox));
  await setSetting(env, DRIVE_SYNC_SETTING, "0");
  await setSetting(env, DRIVE_API_SETTING, JSON.stringify({ state: "on", at: now() }));
  return inbox;
}

const CLIENT_SETTING = "drive_oauth_client";
const TOKENS_SETTING = "drive_oauth";
const PENDING_SETTING = "drive_oauth_pending";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
/** Full Drive access for the signed-in person: read deliveries now, hand results back later. */
const DRIVE_USER_SCOPE = "https://www.googleapis.com/auth/drive";

interface DriveClient {
  id: string;
  secret: string;
}
interface DriveTokens {
  refresh: string;
  access: string;
  expires: number;
  email: string;
}

/** Whoever reads Drive for the studio: the Google account that signed in on the Inbox page. */
export interface DriveAuth {
  email: string;
  token: () => Promise<string>;
}

async function driveClient(env: Env): Promise<DriveClient | null> {
  const raw = await getSetting(env, CLIENT_SETTING);
  return raw ? (JSON.parse(raw) as DriveClient) : null;
}

/** Where Google sends the person back after the sign-in. It is registered on the OAuth client. */
export function driveRedirect(env: Env): string {
  if (!env.PUBLIC_BASE_URL) throw new StudioError("Server is missing PUBLIC_BASE_URL.", 503);
  return new URL("/api/drive/callback", env.PUBLIC_BASE_URL).toString();
}

async function forgetDriveState(env: Env): Promise<void> {
  for (const key of [DRIVE_INBOX_SETTING, DRIVE_API_SETTING, DRIVE_ERROR_SETTING])
    await deleteSetting(env, key);
  await run(env.DB, "DELETE FROM drive_folders WHERE state IN ('waiting','skipped','gone')");
}

/** Saves the OAuth client the studio signs in with. A new client means signing in again. */
export async function setDriveClient(env: Env, id: string, secret: string): Promise<void> {
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id))
    throw new StudioError("That is not a Client ID. It ends with .apps.googleusercontent.com.");
  await setSetting(env, CLIENT_SETTING, JSON.stringify({ id, secret }));
  await deleteSetting(env, TOKENS_SETTING);
  await deleteSetting(env, DRIVE_API_SETTING);
}

/** Where to send the admin to sign in to Google with the Drive account. */
export async function driveSignInUrl(env: Env): Promise<string> {
  const client = await driveClient(env);
  if (!client) throw new StudioError("Add the Client ID and secret first (step 1).", 428);
  const state = uuid();
  await setSetting(env, PENDING_SETTING, JSON.stringify({ state, at: now() }));
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", client.id);
  u.searchParams.set("redirect_uri", driveRedirect(env));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", DRIVE_USER_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("state", state);
  return u.toString();
}

async function googleToken(client: DriveClient, form: Record<string, string>) {
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...form,
      client_id: client.id,
      client_secret: client.secret,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!r.ok || !d.access_token) {
    console.error("[drive] token", r.status, d.error, d.error_description);
    throw new StudioError(
      d.error === "invalid_client"
        ? "Google did not accept the Client ID or secret. Paste them again (step 1)."
        : "Google did not accept the sign-in. Sign in again on the Inbox page.",
      428,
    );
  }
  return d;
}

/** The sign-in coming back from Google. The state is single-use and expires in ten minutes. */
export async function driveCallback(env: Env, code: string, state: string): Promise<void> {
  const raw = await getSetting(env, PENDING_SETTING);
  const pending = raw ? (JSON.parse(raw) as { state: string; at: number }) : null;
  await deleteSetting(env, PENDING_SETTING);
  const client = await driveClient(env);
  if (!client || !pending || !code || pending.state !== state || now() - pending.at > 10 * 60_000)
    throw new StudioError("This sign-in link expired. Start again from the Inbox page.", 400);
  const d = await googleToken(client, {
    grant_type: "authorization_code",
    code,
    redirect_uri: driveRedirect(env),
  });
  if (!d.refresh_token)
    throw new StudioError("Google did not return a lasting sign-in. Sign in again.", 428);
  let email = "Google account";
  let api: DriveApiState = "unknown";
  const about = await fetch(`${API}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${d.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (about.ok) {
    email =
      ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? email;
    api = "on";
  } else if (apiIsOff(about.status, await about.text())) api = "off";
  await setSetting(
    env,
    TOKENS_SETTING,
    JSON.stringify({
      refresh: d.refresh_token,
      access: d.access_token as string,
      expires: now() + (d.expires_in ?? 3600) * 1000,
      email,
    } satisfies DriveTokens),
  );
  await forgetDriveState(env);
  await setSetting(env, DRIVE_API_SETTING, JSON.stringify({ state: api, at: now() }));
}

export async function signOutDrive(env: Env): Promise<void> {
  await deleteSetting(env, TOKENS_SETTING);
  await forgetDriveState(env);
}

/** The signed-in Drive account, with a token that renews itself. Null when nobody signed in. */
export async function resolveDriveAuth(env: Env): Promise<DriveAuth | null> {
  const raw = await getSetting(env, TOKENS_SETTING);
  if (!raw) return null;
  let tokens = JSON.parse(raw) as DriveTokens;
  return {
    email: tokens.email,
    token: async () => {
      if (tokens.expires - now() > 60_000) return tokens.access;
      const client = await driveClient(env);
      if (!client) throw new StudioError("The Google sign-in was removed. Sign in again.", 428);
      const d = await googleToken(client, {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh,
      });
      tokens = {
        ...tokens,
        access: d.access_token as string,
        expires: now() + (d.expires_in ?? 3600) * 1000,
      };
      await setSetting(env, TOKENS_SETTING, JSON.stringify(tokens));
      return tokens.access;
    },
  };
}

export type DriveApiState = "on" | "off" | "unknown";

function apiIsOff(status: number, text: string): boolean {
  return (
    status === 403 &&
    /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)
  );
}

/** Asks Drive whether its API is switched on in the project the sign-in belongs to. */
export async function ensureDriveApi(env: Env, force = false): Promise<DriveApiState> {
  const auth = await resolveDriveAuth(env);
  if (!auth) return "unknown";
  const saved = JSON.parse((await getSetting(env, DRIVE_API_SETTING)) || "{}") as {
    state?: DriveApiState;
    at?: number;
  };
  if (saved.state === "on") return "on";
  if (!force && saved.at && now() - saved.at < 10 * 60_000) return saved.state ?? "unknown";
  let state: DriveApiState = "unknown";
  try {
    const r = await fetch(`${API}/about?fields=kind`, {
      headers: { Authorization: `Bearer ${await auth.token()}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) state = "on";
    else {
      const text = (await r.text()).slice(0, 300);
      if (apiIsOff(r.status, text)) state = "off";
      else console.log("[drive] api check", r.status, text);
    }
  } catch (e) {
    console.log("[drive] api check failed", e instanceof Error ? e.message : e);
  }
  await setSetting(env, DRIVE_API_SETTING, JSON.stringify({ state, at: now() }));
  return state;
}

export async function driveStatus(env: Env): Promise<{
  /** The Google account that signed in for Drive. */
  account: string | null;
  /** Whether the OAuth client (step 1) is saved. */
  client: boolean;
  /** The Google Cloud project number of that client: where the Drive API is switched on. */
  project: string | null;
  redirect: string;
  inbox: DriveInbox | null;
  lastSync: number;
  error: string | null;
  api: DriveApiState;
}> {
  const auth = await resolveDriveAuth(env);
  const client = await driveClient(env);
  const inbox = await driveInbox(env);
  return {
    account: auth?.email ?? null,
    client: !!client,
    project: client?.id.split("-")[0] ?? null,
    redirect: driveRedirect(env),
    inbox,
    lastSync: Number((await getSetting(env, DRIVE_SYNC_SETTING)) ?? 0),
    error: (await getSetting(env, DRIVE_ERROR_SETTING)) || null,
    api: inbox ? "on" : await ensureDriveApi(env).catch(() => "unknown" as const),
  };
}

/** Folder listings one check may ask Drive for; a big first read carries on in the next minute. */
const WALK_CALLS = 24;
/** Deliveries whose photos are counted in one check. */
const SCANS_PER_SYNC = 8;
/**
 * How often a folder on the way down is listed again. Drive does not mark a folder as changed
 * when something is added inside it, so the only way to notice a new drop is to look: the months
 * and anything made in the last week every five minutes, older folders a few times a day.
 */
const FRESH_MS = 7 * 24 * 3600 * 1000;
const RECHECK_MS = 5 * 60 * 1000;
const OLD_RECHECK_MS = 6 * 3600 * 1000;
/** A young delivery may still be filling up, so its photos are counted again now and then. */
const RECOUNT_MS = 60 * 60 * 1000;

/**
 * One pass down the inbox tree. `rows` is what was known before; the map that comes back is what
 * is known now, and every change is also handed to `sql` to be written. `list` returns everything
 * directly inside the given folders.
 */
export async function walkInbox(
  rootId: string,
  rows: DriveFolderRow[],
  list: (parents: string[]) => Promise<DriveFile[]>,
  sql: (text: string, ...params: unknown[]) => void,
  flush: () => Promise<void> = async () => {},
  maxCalls = WALK_CALLS,
  clock: () => number = Date.now,
): Promise<Map<string, DriveFolderRow>> {
  const now = clock;
  const started = Date.now();
  const known = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = (id: string) => [...known.values()].filter((r) => r.parent === id);

  /** A folder that left Drive takes what was under it along; finished work is kept. */
  const drop = (id: string) => {
    const row = known.get(id);
    if (!row) return;
    for (const c of childrenOf(id)) drop(c.id);
    if (row.state === "group") {
      known.delete(id);
      sql("DELETE FROM drive_folders WHERE id = ?", id);
    } else if (row.state === "waiting") {
      row.state = "gone";
      sql("UPDATE drive_folders SET state = 'gone', updated = ? WHERE id = ?", now(), id);
    }
  };

  /** Records the folders found directly inside one folder. */
  const note = (parentId: string, path: string, folders: DriveFile[]) => {
    const present = new Set(folders.map((f) => f.id));
    for (const c of childrenOf(parentId)) if (!present.has(c.id)) drop(c.id);
    for (const f of folders) {
      const modified = Date.parse(f.modifiedTime ?? "") || 0;
      const name = f.name.trim();
      const row = known.get(f.id);
      if (!row) {
        const fresh: DriveFolderRow = {
          id: f.id,
          name,
          path,
          files: 0,
          bytes: 0,
          modified,
          thumbs: "[]",
          state: "group",
          batch: null,
          imported: 0,
          skipped: 0,
          error: null,
          seen: now(),
          updated: now(),
          parent: parentId,
          products: 0,
          walked: 0,
          scanned: 0,
        };
        known.set(f.id, fresh);
        sql(
          "INSERT OR IGNORE INTO drive_folders (id, name, path, modified, state, parent, seen, updated) VALUES (?, ?, ?, ?, 'group', ?, ?, ?)",
          f.id,
          name,
          path,
          modified,
          parentId,
          now(),
          now(),
        );
        continue;
      }
      const changed = modified > row.modified;
      const back = row.state === "gone";
      if (!changed && !back && row.name === name && row.path === path && row.parent === parentId)
        continue;
      // Something was added or taken away inside it: look again.
      if (back) row.state = "group";
      if (changed || back) {
        row.walked = 0;
        row.scanned = 0;
      }
      Object.assign(row, {
        name,
        path,
        modified: Math.max(modified, row.modified),
        parent: parentId,
      });
      sql(
        "UPDATE drive_folders SET name = ?, path = ?, modified = ?, parent = ?, state = ?, walked = ?, scanned = ?, updated = ? WHERE id = ?",
        name,
        path,
        row.modified,
        parentId,
        row.state,
        row.walked,
        row.scanned,
        now(),
        f.id,
      );
    }
  };

  const asDelivery = (row: DriveFolderRow, products: number, photos: number) => {
    for (const c of childrenOf(row.id)) drop(c.id);
    const was = row.state;
    if (was === "group" || was === "gone") row.state = "waiting";
    Object.assign(row, { products, walked: now(), files: photos || row.files });
    if (was === "group") row.scanned = 0;
    sql(
      "UPDATE drive_folders SET state = ?, products = ?, files = ?, walked = ?, scanned = ?, updated = ? WHERE id = ?",
      row.state,
      products,
      row.files,
      row.walked,
      row.scanned,
      now(),
      row.id,
    );
  };

  /** Decides what one folder is from what was found directly inside it. */
  const settle = (row: DriveFolderRow, inside: DriveFile[]) => {
    const kind = classifyFolder(row.name, inside);
    if (kind.kind === "delivery") return asDelivery(row, kind.products, kind.photos);
    if (kind.kind === "product") {
      // A few photos and nothing else is one product, so the folder above is the delivery,
      // unless that folder is a month or a day holding date-named drops.
      const parent = row.parent ? known.get(row.parent) : undefined;
      const siblings = parent ? childrenOf(parent.id) : [];
      if (parent && parent.state === "group" && !siblings.some((x) => isDeliveryName(x.name)))
        return asDelivery(parent, siblings.length, 0);
      return asDelivery(row, 0, kind.photos);
    }
    row.walked = now();
    sql("UPDATE drive_folders SET walked = ?, updated = ? WHERE id = ?", row.walked, now(), row.id);
    if (kind.kind === "group")
      note(
        row.id,
        row.path ? `${row.path} / ${row.name}` : row.name,
        inside.filter((f) => f.mimeType === FOLDER),
      );
  };

  const top = (await list([rootId])).filter((f) => f.mimeType === FOLDER);
  note(rootId, "", top);
  const depth = (r: DriveFolderRow) => (r.path ? r.path.split(" / ").length : 0);
  const due = (r: DriveFolderRow) =>
    r.state === "group" &&
    (r.walked === 0 ||
      now() - r.walked >
        (depth(r) === 0 || now() - r.modified < FRESH_MS ? RECHECK_MS : OLD_RECHECK_MS));
  for (let calls = 1; calls < maxCalls && Date.now() - started < 40_000; calls++) {
    const turn = [...known.values()]
      .filter(due)
      .sort((a, b) => depth(a) - depth(b) || b.modified - a.modified)
      .slice(0, 20);
    if (!turn.length) break;
    const found = await list(turn.map((t) => t.id));
    for (const t of turn)
      // It may have been taken off the list while a sibling was settled.
      if (known.get(t.id)?.state === "group")
        settle(
          t,
          found.filter((f) => f.parents?.includes(t.id)),
        );
    await flush();
  }
  await flush();
  return known;
}

/**
 * Looks at the inbox folder and records what is waiting. The inbox is a tree: months, the day's
 * drop, departments, and at the bottom the folders of product folders, which are the deliveries.
 * Folders are walked a level at a time and remembered, so a quiet Drive costs two requests a
 * check and a new drop is read in a minute or two. Nothing is copied or generated here.
 */
export async function syncDrive(env: Env, force = false): Promise<void> {
  const inbox = await driveInbox(env);
  const creds = inbox ? await resolveDriveAuth(env) : null;
  if (!inbox || !creds) return;
  const last = Number((await getSetting(env, DRIVE_SYNC_SETTING)) ?? 0);
  if (!force && now() - last < 55_000) return;
  await setSetting(env, DRIVE_SYNC_SETTING, String(now()));
  const started = now();
  if (inbox.driveId === undefined) {
    const meta = (await (
      await driveGet(
        creds,
        `/files/${encodeURIComponent(inbox.id)}?fields=driveId&supportsAllDrives=true`,
      )
    ).json()) as { driveId?: string };
    inbox.driveId = meta.driveId ?? "";
    await setSetting(env, DRIVE_INBOX_SETTING, JSON.stringify(inbox));
  }
  const driveId = inbox.driveId;
  const pending: D1PreparedStatement[] = [];
  const flush = async () => {
    while (pending.length) await env.DB.batch(pending.splice(0, 80));
  };
  const sql = (text: string, ...params: unknown[]) =>
    void pending.push(env.DB.prepare(text).bind(...params));
  try {
    const known = await walkInbox(
      inbox.id,
      await all<DriveFolderRow>(env.DB, "SELECT * FROM drive_folders"),
      (parents) => listChildren(creds, parents, fetch, driveId),
      sql,
      flush,
    );

    // Count the photos of deliveries nobody has looked into yet, newest first.
    const unread = [...known.values()]
      .filter(
        (r) =>
          r.state === "waiting" &&
          (r.scanned === 0 || (now() - r.modified < FRESH_MS && now() - r.scanned > RECOUNT_MS)),
      )
      .sort(
        (a, b) =>
          Number(a.scanned > 0) - Number(b.scanned > 0) ||
          Number(a.tracker_state === "delivered") - Number(b.tracker_state === "delivered") ||
          b.modified - a.modified,
      )
      .slice(0, SCANS_PER_SYNC);
    for (const d of unread) {
      if (now() - started > 50_000) break;
      const every = await scanDelivery(creds, d.id, fetch, driveId);
      const photos = plannedPhotos(every, planOf(d)).map((x) => x.photo);
      const bytes = photos.reduce((n, p) => n + Number(p.size ?? 0), 0);
      const thumbs = JSON.stringify(photos.slice(0, 4).map((p) => p.id));
      const products = new Set(
        every.filter((p) => p.relative.includes("/")).map((p) => p.relative.split("/")[0]),
      ).size;
      await run(
        env.DB,
        "UPDATE drive_folders SET files = ?, bytes = ?, thumbs = ?, products = MAX(products, ?), scanned = ?, updated = ? WHERE id = ?",
        photos.length,
        bytes,
        thumbs,
        products,
        now(),
        now(),
        d.id,
      );
    }
    await setSetting(env, DRIVE_ERROR_SETTING, "");
    const states = [...known.values()];
    console.log(
      "[drive] checked:",
      states.filter((r) => r.state === "group").length,
      "folders on the way,",
      states.filter((r) => r.state === "waiting").length,
      "waiting,",
      driveId
        ? closedDrives.has(driveId)
          ? "listed the ordinary way"
          : "listed through the shared drive"
        : "My Drive",
    );
  } catch (e) {
    await flush().catch(() => {});
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

export interface InboxFolder extends Omit<
  DriveFolderRow,
  "thumbs" | "plan" | "tracker_state" | "tracker_info"
> {
  thumbs: string[];
  guess: SkillGuess;
  /** What the client's tracker says about this folder; null when it is not listed there. */
  tracker: TrackerInfo | null;
  /** How many photos somebody gave a choice of their own (a skill, added, or left out). */
  choices: number;
}

export async function inboxFolders(env: Env): Promise<InboxFolder[]> {
  const rows = await all<DriveFolderRow>(
    env.DB,
    "SELECT * FROM drive_folders WHERE state IN ('waiting','importing','failed') OR (state = 'imported' AND updated > ?) ORDER BY CASE state WHEN 'importing' THEN 0 WHEN 'failed' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, modified DESC, path, name LIMIT 600",
    now() - 24 * 3600 * 1000,
  );
  const rules = await driveRules(env);
  return rows.map(({ plan, tracker_state, tracker_info, ...r }) => {
    let tracker: TrackerInfo | null = null;
    if (tracker_state === "delivered" || tracker_state === "working") {
      try {
        tracker = { ...(JSON.parse(tracker_info || "{}") as TrackerInfo), state: tracker_state };
      } catch {
        tracker = null;
      }
    }
    return {
      ...r,
      thumbs: JSON.parse(r.thumbs || "[]") as string[],
      guess: guessSkill(r.name, rules),
      choices: Object.keys(planOf({ plan })).length,
      tracker,
    };
  });
}

export interface FolderPhoto {
  id: string;
  /** Proof for the thumbnail address that this server listed the photo. */
  token: string;
  name: string;
  /** The product folder it sits in ("" for a photo straight in the delivery). */
  product: string;
  view: number | null;
  tag: boolean;
  /** Generated when nobody says otherwise: one of the first two views of its product. */
  usual: boolean;
}

/** Every photo in a delivery, for looking through before approving it, with the saved choices. */
export async function folderPhotos(
  env: Env,
  folderId: string,
): Promise<{ id: string; name: string; path: string; photos: FolderPhoto[]; plan: FolderPlan }> {
  const row = await first<DriveFolderRow>(
    env.DB,
    "SELECT * FROM drive_folders WHERE id = ? AND state != 'group'",
    folderId,
  );
  const creds = await resolveDriveAuth(env);
  if (!row) throw new StudioError("That folder is no longer in the inbox.", 404);
  if (!creds) throw new StudioError("Sign in with Google first.", 428);
  const every = await scanDelivery(creds, row.id, fetch, (await driveInbox(env))?.driveId ?? "");
  const usual = new Set(pickProductPhotos(every).map((p) => p.id));
  const photos: FolderPhoto[] = [];
  for (const p of every) {
    const cut = p.relative.lastIndexOf("/");
    photos.push({
      id: p.id,
      token: await signValue(env, p.id),
      name: p.relative.slice(cut + 1),
      product: cut < 0 ? "" : p.relative.slice(0, cut),
      view: viewNumber(p.relative),
      tag: isTagPhoto(p.relative),
      usual: usual.has(p.id),
    });
  }
  return { id: row.id, name: row.name, path: row.path, photos, plan: tidyPlan(every, planOf(row)) };
}

/** Saves which photos of a waiting delivery get generated and with which skill. */
export async function saveFolderPlan(
  env: Env,
  folderId: string,
  plan: FolderPlan,
  skills: string[],
): Promise<{ files: number; choices: number }> {
  const row = await first<DriveFolderRow>(
    env.DB,
    "SELECT * FROM drive_folders WHERE id = ?",
    folderId,
  );
  const creds = await resolveDriveAuth(env);
  if (!row) throw new StudioError("That folder is no longer in the inbox.", 404);
  if (row.state !== "waiting" && row.state !== "failed")
    throw new StudioError("This folder was already approved; change skills inside its batch.", 409);
  if (!creds) throw new StudioError("Sign in with Google first.", 428);
  for (const choice of Object.values(plan))
    if (choice !== "" && choice !== "*" && !skills.includes(choice))
      throw new StudioError(`There is no skill called "${choice.slice(0, 40)}".`);
  const every = await scanDelivery(creds, row.id, fetch, (await driveInbox(env))?.driveId ?? "");
  const tidy = tidyPlan(every, plan);
  const photos = plannedPhotos(every, tidy).map((x) => x.photo);
  if (!photos.length) throw new StudioError("Keep at least one photo to generate.");
  await run(
    env.DB,
    "UPDATE drive_folders SET plan = ?, files = ?, bytes = ?, thumbs = ?, scanned = ?, updated = ? WHERE id = ?",
    Object.keys(tidy).length ? JSON.stringify(tidy) : null,
    photos.length,
    photos.reduce((n, p) => n + Number(p.size ?? 0), 0),
    JSON.stringify(photos.slice(0, 4).map((p) => p.id)),
    now(),
    now(),
    row.id,
  );
  return { files: photos.length, choices: Object.keys(tidy).length };
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
  const base =
    (same ?? mine)
      ? (JSON.parse((same ?? mine)!.config) as Config)
      : ({ ...DEFAULT_CONFIG, mode: "7" } as Config);
  const config: Config = { ...base, skill, identity: undefined };
  if (!config.model) config.model = await resolveEngineModel(env);
  const problem = validateConfig(config);
  if (problem) throw new StudioError(problem);
  return config;
}

async function dispatchImport(env: Env, job: ImportJob): Promise<void> {
  if (!env.RUNNER)
    throw new StudioError("The import runner is not available on this deployment.", 500);
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
  const row = await first<DriveFolderRow>(
    env.DB,
    "SELECT * FROM drive_folders WHERE id = ?",
    folderId,
  );
  if (!row) throw new StudioError("That folder is no longer in the inbox.", 404);
  if (row.state === "importing")
    throw new StudioError("This folder is already being imported.", 409);
  if (row.state === "imported") throw new StudioError("This folder was already imported.", 409);
  if (!row.files) throw new StudioError("This folder has no photos yet.");
  let batchId = row.batch;
  if (batchId && !(await first(env.DB, "SELECT id FROM batches WHERE id = ?", batchId)))
    batchId = null;
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

/** Skips every waiting folder under one place in the tree ("October", or one day's drop). */
export async function skipUnder(env: Env, path: string): Promise<number> {
  return run(
    env.DB,
    "UPDATE drive_folders SET state = 'skipped', updated = ? WHERE state IN ('waiting','failed') AND (path = ? OR substr(path, 1, ?) = ?)",
    now(),
    path,
    path.length + 3,
    `${path} / `,
  );
}

/** Puts every skipped folder back in the inbox. */
export async function unskipAll(env: Env): Promise<number> {
  return run(
    env.DB,
    "UPDATE drive_folders SET state = 'waiting', updated = ? WHERE state = 'skipped'",
    now(),
  );
}

export async function skippedCount(env: Env): Promise<number> {
  const r = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM drive_folders WHERE state = 'skipped'",
  );
  return r?.n ?? 0;
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
  creds: DriveAuth,
  fileId: string,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  try {
    const meta = (await (
      await driveGet(
        creds,
        `/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`,
      )
    ).json()) as DriveFile;
    if (!meta.thumbnailLink) return null;
    const url = meta.thumbnailLink.replace(/=s\d+(-[a-z0-9-]+)?$/i, "=s1600");
    const token = await creds.token();
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const mime = r.headers.get("content-type")?.split(";")[0] ?? "";
    if (!r.ok || !IMAGE_TYPES.includes(mime)) return null;
    const bytes = await r.arrayBuffer();
    return bytes.byteLength > 20_000 && bytes.byteLength <= 3 * 1024 * 1024
      ? { bytes, mime }
      : null;
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
    const row = await first<DriveFolderRow>(
      env.DB,
      "SELECT * FROM drive_folders WHERE id = ?",
      job.folder,
    );
    const batch = await first<{ id: string; owner: string; config: string }>(
      env.DB,
      "SELECT id, owner, config FROM batches WHERE id = ?",
      job.batch,
    );
    const creds = await resolveDriveAuth(env);
    if (!row || row.state !== "importing") return false;
    if (!batch) return (void (await fail("The batch for this folder was deleted.")), false);
    if (!creds) return (void (await fail("Nobody is signed in to Google Drive any more.")), false);
    const config = JSON.parse(batch.config) as Config;
    const planned = plannedPhotos(
      await scanDelivery(creds, job.folder, fetch, (await driveInbox(env))?.driveId ?? ""),
      planOf(row),
    );
    const ownSkill = new Map(planned.map((x) => [x.photo.id, x.skill]));
    const photos = planned.map((x) => x.photo);
    const have = new Set(
      (
        await all<{ stem: string }>(env.DB, "SELECT stem FROM sources WHERE batch = ?", batch.id)
      ).map((s) => s.stem),
    );
    let imported = have.size;
    let skipped = 0;
    const todo: { photo: (typeof photos)[number]; name: string; stem: string }[] = [];
    for (const photo of photos) {
      const name = importName(row.name, photo.relative);
      const stem = stemKey(name);
      if (have.has(stem)) continue;
      if (
        !IMAGE_TYPES.includes(photo.mimeType) ||
        Number(photo.size ?? 0) > MAX_PHOTO ||
        !isValidSourceName(name)
      ) {
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
        const media = await driveGet(
          creds,
          `/files/${encodeURIComponent(photo.id)}?alt=media&supportsAllDrives=true`,
        );
        const bytes = await media.arrayBuffer();
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: photo.mimeType } });
        const ref = await referenceCopy(creds, photo.id);
        const referenceKey = ref ? `${key}.reference` : null;
        if (ref)
          await env.BUCKET.put(referenceKey!, ref.bytes, {
            httpMetadata: { contentType: ref.mime },
          });
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
            skill: ownSkill.get(photo.id) ?? null,
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

/** A preview of one photo, only for photos the inbox itself listed (or handed a token for). */
export async function driveThumb(
  env: Env,
  fileId: string,
  token = "",
  large = false,
): Promise<Response> {
  const listed =
    (token && token === (await signValue(env, fileId))) ||
    (await first(
      env.DB,
      "SELECT id FROM drive_folders WHERE instr(thumbs, ?) > 0 LIMIT 1",
      `"${fileId}"`,
    ));
  const creds = await resolveDriveAuth(env);
  if (!listed || !creds) return new Response(null, { status: 404 });
  const meta = (await (
    await driveGet(
      creds,
      `/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`,
    )
  ).json()) as DriveFile;
  if (!meta.thumbnailLink) return new Response(null, { status: 404 });
  const bearer = await creds.token();
  const size = large ? "=s1600" : "=s240";
  const r = await fetch(meta.thumbnailLink.replace(/=s\d+(-[a-z0-9-]+)?$/i, size), {
    headers: { Authorization: `Bearer ${bearer}` },
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
