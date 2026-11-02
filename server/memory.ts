/**
 * Brand memory: what the team's own corrections teach the studio. A learning run reads the recent
 * event stream (revisions, presets, approvals, deletions, engine failures, rule and reference
 * changes), asks the text model for the lessons behind them, and stores each as a suggestion.
 * Accepted suggestions become active and are handed to the prompt writer of every later brief.
 */
import { all, first, now, run, uuid } from "./db";
import type { Env } from "./env";
import { eventsSince, insertEvents, type EventRow } from "./events";
import { getSetting, setSetting } from "./settings";

export interface MemoryRow {
  id: string;
  scope: string;
  kind: "rule" | "avoid" | "insight";
  title: string;
  text: string;
  evidence: number;
  examples: string;
  status: "suggested" | "active" | "dismissed";
  created: number;
  updated: number;
}

export const LEARN_LAST_RUN = "memory_last_learn";
const LEARN_EVERY_MS = 6 * 24 * 3600_000; // weekly, with a day of slack
const WINDOW_DAYS = 14;

export async function listMemory(env: Env): Promise<MemoryRow[]> {
  return all<MemoryRow>(
    env.DB,
    "SELECT * FROM memory ORDER BY CASE status WHEN 'suggested' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, evidence DESC, updated DESC",
  );
}

/** Lines the prompt writer follows for a skill: the active global and skill-scoped memory. */
export async function activeMemoryLines(env: Env, skillId: string): Promise<string[]> {
  const rows = await all<MemoryRow>(
    env.DB,
    "SELECT * FROM memory WHERE status = 'active' AND scope IN ('global', ?) ORDER BY evidence DESC LIMIT 20",
    `skill:${skillId}`,
  );
  return rows.map(
    (r) => `${r.kind === "avoid" ? "AVOID" : "RULE"}: ${r.title ? `${r.title}: ` : ""}${r.text}`,
  );
}

export async function setMemoryStatus(
  env: Env,
  id: string,
  status: MemoryRow["status"],
  text?: string,
): Promise<boolean> {
  const changed = text
    ? await run(
        env.DB,
        "UPDATE memory SET status = ?, text = ?, updated = ? WHERE id = ?",
        status,
        text,
        now(),
        id,
      )
    : await run(
        env.DB,
        "UPDATE memory SET status = ?, updated = ? WHERE id = ?",
        status,
        now(),
        id,
      );
  return changed > 0;
}

export async function deleteMemory(env: Env, id: string): Promise<boolean> {
  return (await run(env.DB, "DELETE FROM memory WHERE id = ?", id)) > 0;
}

export async function addMemory(
  env: Env,
  item: Pick<MemoryRow, "scope" | "kind" | "title" | "text"> & { status?: MemoryRow["status"] },
): Promise<MemoryRow> {
  const row: MemoryRow = {
    id: uuid(),
    scope: item.scope,
    kind: item.kind,
    title: item.title,
    text: item.text,
    evidence: 0,
    examples: "[]",
    status: item.status ?? "active",
    created: now(),
    updated: now(),
  };
  await run(
    env.DB,
    "INSERT INTO memory (id, scope, kind, title, text, evidence, examples, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    row.id,
    row.scope,
    row.kind,
    row.title,
    row.text,
    row.evidence,
    row.examples,
    row.status,
    row.created,
    row.updated,
  );
  return row;
}

function parseData(e: EventRow): Record<string, unknown> {
  try {
    return JSON.parse(e.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function top(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${v}× ${k}`);
}

function bump(map: Map<string, number>, key: string | undefined | null) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** The recent events, condensed per skill into the text the learner reads. */
export function digestEvents(events: EventRow[]): string {
  const bySkill = new Map<string, EventRow[]>();
  for (const e of events) {
    const key =
      e.skill || e.mode ? `${e.skill ?? "no-skill"} (approach ${e.mode ?? "?"})` : "studio";
    bySkill.set(key, [...(bySkill.get(key) ?? []), e]);
  }
  const sections: string[] = [];
  for (const [skill, list] of bySkill) {
    const kinds = new Map<string, number>();
    const revisions = new Map<string, number>();
    const presets = new Map<string, number>();
    const errors = new Map<string, number>();
    const concerns = new Map<string, number>();
    const clicks = new Map<string, number>();
    const rules: string[] = [];
    for (const e of list) {
      bump(kinds, e.kind);
      const d = parseData(e);
      if (e.kind === "revise" || e.kind === "revise-all")
        bump(revisions, String(d.edit ?? "").slice(0, 160));
      if (e.kind === "preset") bump(presets, String(d.label ?? ""));
      if (e.kind === "engine.failed") bump(errors, String(d.error ?? "").slice(0, 120));
      if (e.kind === "engine.result") {
        if (d.concern) bump(concerns, String(d.concern).slice(0, 120));
        bump(concerns, `status ${String(d.status)}`);
      }
      if (e.kind === "click") {
        const label = String(d.label ?? "").slice(0, 60);
        // The team rarely presses Approve: a download is the real sign an image was liked.
        if (/^download this image$/i.test(label)) bump(kinds, "download (liked)");
        bump(clicks, label);
      }
      if (e.kind === "rule" && rules.length < 12) rules.push(String(d.summary ?? "").slice(0, 200));
    }
    sections.push(
      [
        `## ${skill}`,
        `Events: ${top(kinds, 12).join(", ")}`,
        revisions.size
          ? `Revision texts the team typed or chose: ${top(revisions, 25).join(" | ")}`
          : "",
        presets.size ? `Revision presets: ${top(presets, 10).join(", ")}` : "",
        concerns.size ? `Engine results and review concerns: ${top(concerns, 12).join(" | ")}` : "",
        errors.size ? `Engine failures: ${top(errors, 10).join(" | ")}` : "",
        rules.length ? `Rule changes: ${rules.join(" | ")}` : "",
        clicks.size ? `Most used buttons: ${top(clicks, 15).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return sections.join("\n\n").slice(0, 14000);
}

export const LEARN_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scope: { type: "string" },
          kind: { type: "string", enum: ["rule", "avoid", "insight"] },
          title: { type: "string" },
          text: { type: "string" },
          evidence: { type: "integer" },
          examples: { type: "array", items: { type: "string" } },
        },
        required: ["scope", "kind", "title", "text", "evidence", "examples"],
      },
    },
  },
  required: ["insights"],
};

export function learnInstruction(digest: string, skillIds: string[]): string {
  return [
    "You are the studio's memory. Below is a digest of what the team did in Max Fashion Studio over the last two weeks: which images they sent back for revision and with what words, which presets they used, what the engines failed on, what the automatic review flagged, which rules they changed and which buttons they pressed most.",
    "Find the lessons behind these actions: recurring corrections that a prompt rule could prevent next time, things to avoid for a given skill, and insights about what the team wants. Read the signals this way: a downloaded image was liked; a retried, re-generated or deleted image was not; a revision text says exactly what was wrong; a review concern from the engine is a defect the team had to deal with; a changed setting or rule shows a preference. Each lesson must be supported by several events, not one. Write them as short, concrete, catalogue-safe instructions a prompt writer can follow (no body-focused or sensual wording). Never invent facts not in the digest.",
    `Scopes: "global" when a lesson applies to every skill, otherwise "skill:<id>" with one of these ids: ${skillIds.join(", ")}.`,
    "Return at most 8 lessons, best first, as JSON {insights:[{scope, kind (rule|avoid|insight), title (max 8 words), text (one or two sentences), evidence (number of supporting events), examples (up to 3 short quotes from the digest)}]}. Return an empty list when the digest holds nothing worth keeping.",
    "",
    digest,
  ].join("\n\n");
}

/** Parse the learner's answer; anything malformed yields no suggestions. */
export function parseLearn(text: string): {
  scope: string;
  kind: MemoryRow["kind"];
  title: string;
  text: string;
  evidence: number;
  examples: string[];
}[] {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const d = JSON.parse(cleaned) as { insights?: unknown[] };
    return (d.insights ?? [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.text === "string" && x.text.trim())
      .map((x) => ({
        scope: /^(global|skill:[a-z0-9-]+|mode:\d)$/.test(String(x.scope))
          ? String(x.scope)
          : "global",
        kind: (x.kind === "rule" || x.kind === "avoid" ? x.kind : "insight") as MemoryRow["kind"],
        title: String(x.title ?? "").slice(0, 80),
        text: String(x.text).slice(0, 600),
        evidence: Math.max(0, Math.round(Number(x.evidence) || 0)),
        examples: Array.isArray(x.examples)
          ? x.examples.slice(0, 3).map((s) => String(s).slice(0, 160))
          : [],
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

/**
 * One learning run: digest the recent events, ask the model, store new suggestions (a lesson the
 * memory already holds, under any status, only gains evidence). Returns how many were added.
 */
export async function learn(
  env: Env,
  ask: (instruction: string, schema: unknown) => Promise<string>,
  skillIds: string[],
): Promise<{ added: number; updated: number; events: number }> {
  const events = await eventsSince(env, now() - WINDOW_DAYS * 24 * 3600_000);
  if (events.length < 20) {
    await setSetting(env, LEARN_LAST_RUN, String(now()));
    return { added: 0, updated: 0, events: events.length };
  }
  const digest = digestEvents(events);
  const lessons = parseLearn(await ask(learnInstruction(digest, skillIds), LEARN_SCHEMA));
  const existing = await listMemory(env);
  let added = 0;
  let updated = 0;
  for (const l of lessons) {
    const dup = existing.find(
      (m) =>
        m.scope === l.scope &&
        (normalise(m.title) === normalise(l.title) || normalise(m.text) === normalise(l.text)),
    );
    if (dup) {
      await run(
        env.DB,
        "UPDATE memory SET evidence = evidence + ?, examples = ?, updated = ? WHERE id = ?",
        l.evidence,
        JSON.stringify(l.examples),
        now(),
        dup.id,
      );
      updated++;
      continue;
    }
    await run(
      env.DB,
      "INSERT INTO memory (id, scope, kind, title, text, evidence, examples, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?)",
      uuid(),
      l.scope,
      l.kind,
      l.title,
      l.text,
      l.evidence,
      JSON.stringify(l.examples),
      now(),
      now(),
    );
    added++;
  }
  await setSetting(env, LEARN_LAST_RUN, String(now()));
  await insertEvents(env, [
    { kind: "learn", actor: "learn", data: { added, updated, events: events.length } },
  ]);
  return { added, updated, events: events.length };
}

/** True when the weekly run is due. */
export async function learnDue(env: Env): Promise<boolean> {
  const last = Number((await getSetting(env, LEARN_LAST_RUN)) ?? 0);
  if (now() - last < LEARN_EVERY_MS) return false;
  const any = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM events");
  return (any?.n ?? 0) > 0;
}
