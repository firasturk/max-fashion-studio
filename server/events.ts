/**
 * The studio's event stream: every click and decision in the browser, every engine outcome and
 * every learning run, in one table. Writes never fail a request: an event that cannot be stored
 * is logged and dropped.
 */
import { all, now, run, uuid } from "./db";
import type { Env } from "./env";

export type Actor = "user" | "engine" | "learn";

export interface EventInput {
  kind: string;
  actor?: Actor;
  user?: string | null;
  batch?: string | null;
  task?: string | null;
  source?: string | null;
  skill?: string | null;
  mode?: string | null;
  data?: Record<string, unknown>;
  /** Client-side time, when the browser reports it. */
  at?: number;
}

export interface EventRow {
  id: string;
  at: number;
  user: string | null;
  actor: Actor;
  kind: string;
  batch: string | null;
  task: string | null;
  source: string | null;
  skill: string | null;
  mode: string | null;
  data: string;
}

const MAX_DATA = 4000;

function clip(data: Record<string, unknown> | undefined): string {
  const text = JSON.stringify(data ?? {});
  return text.length > MAX_DATA ? JSON.stringify({ truncated: text.slice(0, MAX_DATA) }) : text;
}

export async function insertEvents(env: Env, events: EventInput[]): Promise<number> {
  if (!events.length) return 0;
  const stmts = events.map((e) =>
    env.DB.prepare(
      "INSERT INTO events (id, at, user, actor, kind, batch, task, source, skill, mode, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      uuid(),
      typeof e.at === "number" && Math.abs(e.at - now()) < 7 * 24 * 3600_000 ? e.at : now(),
      e.user ?? null,
      e.actor ?? "user",
      e.kind.slice(0, 60),
      e.batch ?? null,
      e.task ?? null,
      e.source ?? null,
      e.skill ?? null,
      e.mode ?? null,
      clip(e.data),
    ),
  );
  await env.DB.batch(stmts);
  return events.length;
}

/** One event, never throwing: the caller's work matters more than the record of it. */
export async function logEvent(env: Env, e: EventInput): Promise<void> {
  try {
    await insertEvents(env, [e]);
  } catch (err) {
    console.error("[events]", e.kind, err instanceof Error ? err.message : String(err));
  }
}

export async function eventsSince(env: Env, since: number, limit = 5000): Promise<EventRow[]> {
  return all<EventRow>(
    env.DB,
    "SELECT * FROM events WHERE at >= ? ORDER BY at DESC LIMIT ?",
    since,
    limit,
  );
}

export interface ActivitySummary {
  since: number;
  total: number;
  byKind: { kind: string; n: number }[];
  byUser: { user: string | null; n: number }[];
  recent: EventRow[];
}

export async function activitySummary(env: Env, days = 7, recent = 150): Promise<ActivitySummary> {
  const since = now() - days * 24 * 3600_000;
  const [byKind, byUser, rows, total] = await Promise.all([
    all<{ kind: string; n: number }>(
      env.DB,
      "SELECT kind, COUNT(*) AS n FROM events WHERE at >= ? GROUP BY kind ORDER BY n DESC",
      since,
    ),
    all<{ user: string | null; n: number }>(
      env.DB,
      "SELECT user, COUNT(*) AS n FROM events WHERE at >= ? GROUP BY user ORDER BY n DESC",
      since,
    ),
    eventsSince(env, since, recent),
    all<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM events WHERE at >= ?", since),
  ]);
  return { since, total: total[0]?.n ?? 0, byKind, byUser, recent: rows };
}

/** Events older than the retention window are dropped; the memory keeps what they taught. */
export async function pruneEvents(env: Env, keepDays = 120): Promise<number> {
  return run(env.DB, "DELETE FROM events WHERE at < ?", now() - keepDays * 24 * 3600_000);
}
