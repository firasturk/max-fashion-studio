/**
 * The client's tracker sheet, read only. The studio copies its lines to know which folders were
 * delivered, which are still open and which were uploaded for publishing. It never writes to it.
 */
import type { Env } from "./env";
import { errorMessage } from "./errors";
import { all, first, now } from "./db";
import { getSetting, setSetting } from "./settings";
import {
  driveGet,
  driveInbox,
  listChildren,
  resolveDriveAuth,
  type DriveAuth,
  type DriveInbox,
  type TrackerInfo,
} from "./drive";
import { readXlsx } from "@shared/xlsx";
import {
  readTracker,
  tabMonth,
  trackerIndex,
  trackerMatch,
  type TrackerRow,
} from "@shared/tracker";

const SHEET_SETTING = "tracker_sheet";
const SYNC_SETTING = "tracker_last_sync";
const ERROR_SETTING = "tracker_error";
const MATCH_SETTING = "tracker_matched";
const SHEET_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** The sheet is read this often; the team edits it a few times a day. */
const EVERY_MS = 15 * 60 * 1000;
/** Months kept: enough to see what is still open without carrying years of history. */
const MONTHS_BACK = 6;

interface TrackerSheet {
  id: string;
  name: string;
}

async function trackerSheet(env: Env): Promise<TrackerSheet | null> {
  try {
    return JSON.parse((await getSetting(env, SHEET_SETTING)) ?? "null") as TrackerSheet | null;
  } catch {
    return null;
  }
}

/** The tracker sits beside the delivery folders or a level or two above them. */
async function findTracker(creds: DriveAuth, inbox: DriveInbox): Promise<TrackerSheet | null> {
  let folder = inbox.id;
  for (let up = 0; up < 4; up++) {
    const inside = await listChildren(creds, [folder], fetch, inbox.driveId ?? "");
    const sheet = inside.find((f) => f.mimeType === SHEET_TYPE && /tracker/i.test(f.name));
    if (sheet) return { id: sheet.id, name: sheet.name };
    const meta = (await (
      await driveGet(
        creds,
        `/files/${encodeURIComponent(folder)}?fields=parents&supportsAllDrives=true`,
      )
    ).json()) as { parents?: string[] };
    if (!meta.parents?.[0]) return null;
    folder = meta.parents[0];
  }
  return null;
}

const cutoff = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - MONTHS_BACK);
  return d.toISOString().slice(0, 7);
};

/** Writes on every Drive folder what the tracker says about it. */
async function matchFolders(env: Env, rows: TrackerRow[]): Promise<number> {
  const index = trackerIndex(rows);
  const folders = await all<{
    id: string;
    name: string;
    path: string;
    tracker_state: string | null;
    tracker_info: string | null;
  }>(
    env.DB,
    "SELECT id, name, path, tracker_state, tracker_info FROM drive_folders WHERE state != 'group'",
  );
  const changes: D1PreparedStatement[] = [];
  for (const f of folders) {
    const hit = trackerMatch(index, f.name, f.path);
    const state = hit ? (hit.delivered ? "delivered" : "working") : null;
    const info = hit
      ? JSON.stringify({
          line: hit.name,
          received: hit.received,
          sent: hit.sent,
          upload: hit.upload,
          published: hit.published,
        } satisfies Omit<TrackerInfo, "state">)
      : null;
    if (state === f.tracker_state && info === f.tracker_info) continue;
    changes.push(
      env.DB.prepare(
        "UPDATE drive_folders SET tracker_state = ?, tracker_info = ? WHERE id = ?",
      ).bind(state, info, f.id),
    );
  }
  while (changes.length) await env.DB.batch(changes.splice(0, 80));
  await setSetting(env, MATCH_SETTING, String(now()));
  return folders.length;
}

async function storedRows(env: Env): Promise<TrackerRow[]> {
  const rows = await all<Omit<TrackerRow, "delivered"> & { delivered: number }>(
    env.DB,
    "SELECT month, pos, name, done, shared, delivered, received, sent, note, upload, published FROM tracker_rows ORDER BY month, pos",
  );
  return rows.map((r) => ({ ...r, delivered: !!r.delivered }));
}

/**
 * Reads the tracker when it is time (or at once when asked), and keeps the Drive folders in step
 * with it. Between reads, folders that turned up since the last match are matched from the copy.
 */
export async function syncTracker(env: Env, force = false): Promise<void> {
  const inbox = await driveInbox(env);
  const creds = inbox ? await resolveDriveAuth(env) : null;
  if (!inbox || !creds) return;
  const last = Number((await getSetting(env, SYNC_SETTING)) ?? 0);
  if (!force && now() - last < EVERY_MS) {
    const matched = Number((await getSetting(env, MATCH_SETTING)) ?? 0);
    const fresh = await first<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM drive_folders WHERE state != 'group' AND seen > ?",
      matched,
    );
    if (fresh?.n) await matchFolders(env, await storedRows(env));
    return;
  }
  await setSetting(env, SYNC_SETTING, String(now()));
  try {
    let sheet = await trackerSheet(env);
    if (!sheet) {
      sheet = await findTracker(creds, inbox);
      if (!sheet) {
        await setSetting(
          env,
          ERROR_SETTING,
          "No tracker sheet was found next to the Drive folders.",
        );
        return;
      }
      await setSetting(env, SHEET_SETTING, JSON.stringify(sheet));
    }
    const file = await driveGet(
      creds,
      `/files/${encodeURIComponent(sheet.id)}/export?mimeType=${encodeURIComponent(XLSX)}`,
    );
    const from = cutoff();
    const rows = readTracker(
      await readXlsx(await file.arrayBuffer(), (name) => {
        const month = tabMonth(name);
        return month ? month >= from : /publishing status/i.test(name);
      }),
    );
    // An empty read is a sheet somebody is rearranging, not a tracker with nothing in it.
    if (!rows.length) throw new Error("The tracker sheet has no month tabs the studio can read.");
    const writes = [env.DB.prepare("DELETE FROM tracker_rows")];
    for (const r of rows)
      writes.push(
        env.DB.prepare(
          "INSERT OR REPLACE INTO tracker_rows (month, pos, name, key, done, shared, delivered, received, sent, note, upload, published) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          r.month,
          r.pos,
          r.name,
          r.done,
          r.shared,
          r.delivered ? 1 : 0,
          r.received,
          r.sent,
          r.note,
          r.upload,
          r.published,
        ),
      );
    // One batch is one transaction: readers never see a half-written copy.
    await env.DB.batch(writes);
    const folders = await matchFolders(env, rows);
    await setSetting(env, ERROR_SETTING, "");
    console.log("[tracker] read", rows.length, "lines, matched against", folders, "folders");
  } catch (e) {
    await setSetting(env, ERROR_SETTING, errorMessage(e).slice(0, 300));
    throw e;
  }
}

export interface TrackerMonth {
  month: string;
  folders: number;
  products: number;
  deliveredFolders: number;
  deliveredProducts: number;
  uploadedFolders: number;
  rows: TrackerRow[];
}

/** The copy of the tracker, newest month first, for looking at. */
export async function trackerView(env: Env): Promise<{
  sheet: TrackerSheet | null;
  lastSync: number;
  error: string | null;
  months: TrackerMonth[];
}> {
  const months = new Map<string, TrackerMonth>();
  for (const r of await storedRows(env)) {
    const m = months.get(r.month) ?? {
      month: r.month,
      folders: 0,
      products: 0,
      deliveredFolders: 0,
      deliveredProducts: 0,
      uploadedFolders: 0,
      rows: [],
    };
    m.folders++;
    m.products += r.shared;
    if (r.delivered) {
      m.deliveredFolders++;
      m.deliveredProducts += r.done || r.shared;
    }
    if (r.upload) m.uploadedFolders++;
    m.rows.push(r);
    months.set(r.month, m);
  }
  return {
    sheet: await trackerSheet(env),
    lastSync: Number((await getSetting(env, SYNC_SETTING)) ?? 0),
    error: (await getSetting(env, ERROR_SETTING)) || null,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
}
