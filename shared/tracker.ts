/**
 * The client's tracker sheet, read only. One tab per month lists the folders received and whether
 * they were delivered; a "Publishing Status" tab lists the folders uploaded for publishing. The
 * studio never writes to it.
 */
import type { Sheet } from "./xlsx";

export interface TrackerRow {
  /** The month tab, as "2026-11". */
  month: string;
  /** Position inside its tab, to keep the sheet's order. */
  pos: number;
  /** The folder as the tracker names it. */
  name: string;
  /** Products delivered so far, and products received. */
  done: number;
  shared: number;
  delivered: boolean;
  /** ISO dates (YYYY-MM-DD), or "" when the sheet has none. */
  received: string;
  sent: string;
  note: string;
  /** The upload it went out in ("25Nov/ReadyToPublish") and what the client says about it. */
  upload: string;
  published: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "AI-Tracker-Nov-2026" is "2026-11"; a tab without a year is an old one and is left alone. */
export function tabMonth(tab: string): string | null {
  const m = /^AI-Tracker-([A-Za-z]+)-(\d{4})$/.exec(tab.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  return month < 0 ? null : `${m[2]}-${String(month + 1).padStart(2, "0")}`;
}

/** The same folder written two ways compares equal: case, spaces, dashes, dots and underscores. */
export function trackerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .trim();
}

/** A date as Sheets stores it (days since 30 Dec 1899) to YYYY-MM-DD. */
export function sheetDate(value: string): string {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n < 20_000 || n > 80_000) return "";
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
}

const count = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * The rows of every month tab, with what the Publishing Status tab says about each folder. A
 * month tab is: folder, delivered so far, received, status, date received, date sent, note.
 */
export function readTracker(sheets: Sheet[]): TrackerRow[] {
  const uploads = new Map<string, { upload: string; published: string }>();
  for (const sheet of sheets) {
    if (!/publishing status/i.test(sheet.name)) continue;
    for (const r of sheet.rows.slice(1)) {
      const upload = (r[0] ?? "").trim();
      const published = (r[2] ?? "").trim();
      for (const folder of (r[1] ?? "").split(/\r?\n/))
        if (folder.trim()) uploads.set(trackerKey(folder), { upload, published });
    }
  }
  const out: TrackerRow[] = [];
  for (const sheet of sheets) {
    const month = tabMonth(sheet.name);
    if (!month) continue;
    sheet.rows.forEach((r, pos) => {
      const name = (r[0] ?? "").trim();
      const shared = count(r[2] ?? "");
      // The header line, the totals line at the bottom and notes have no folder or no count.
      if (!name || !shared || /^column \d+$/i.test(name)) return;
      const up = uploads.get(trackerKey(name));
      out.push({
        month,
        pos,
        name,
        done: count(r[1] ?? ""),
        shared,
        delivered: /^completed$/i.test((r[3] ?? "").trim()),
        received: sheetDate(r[4] ?? ""),
        sent: sheetDate(r[5] ?? ""),
        note: (r[6] ?? "").trim().slice(0, 200),
        upload: up?.upload ?? "",
        published: up?.published ?? "",
      });
    });
  }
  return out;
}

export type TrackerState = "delivered" | "working";

/**
 * What the tracker says about one Drive folder: it is listed under its own name or under the
 * name of a folder it sits in (the tracker often has one line for a whole department).
 */
export function trackerMatch(
  rows: Map<string, TrackerRow>,
  name: string,
  path: string,
): TrackerRow | null {
  for (const part of [name, ...path.split(" / ").reverse()]) {
    const hit = part && rows.get(trackerKey(part));
    if (hit) return hit;
  }
  return null;
}

/** Tracker rows by folder; when a folder is listed twice, the delivered line wins. */
export function trackerIndex(rows: TrackerRow[]): Map<string, TrackerRow> {
  const out = new Map<string, TrackerRow>();
  for (const r of rows) {
    const key = trackerKey(r.name);
    const had = out.get(key);
    if (!had || (r.delivered && !had.delivered)) out.set(key, r);
  }
  return out;
}
