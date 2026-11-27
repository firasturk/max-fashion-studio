/**
 * Skills the studio proposes by itself. It watches a short list of public Pinterest accounts and
 * boards; each board with enough usable photographs becomes a suggestion a person approves or
 * dismisses. Nothing here creates a skill: approval does, through the same path as New skill.
 */
import type { Env } from "./env";
import { errorMessage, StudioError } from "./errors";
import { all, first, now, run, uuid } from "./db";
import { getSetting, setSetting } from "./settings";
import { askVision } from "./skillbuilder";
import { decodeEntities, downloadPins, pinterestPins } from "./pinterest";
import {
  STARTER_SOURCES,
  groupByBoard,
  originKey,
  parsePinterestLink,
  type Pin,
} from "@shared/pinterest";

const SOURCES_SETTING = "pinterest_sources";
const RUN_SETTING = "suggest_last_run";
/** A look needs at least this many usable photographs to be worth proposing. */
const MIN_PHOTOS = 5;
const MAX_PHOTOS = 12;
/** How many boards one pass may study, and how many proposals may wait at once. */
const BOARDS_PER_PASS = 4;
const WAITING_LIMIT = 8;

export interface Suggestion {
  id: string;
  link: string;
  title: string;
  caption: string;
  why: string;
  pins: { id: string; thumb: string; image: string }[];
  created: number;
}

export async function suggestionSources(env: Env): Promise<string[]> {
  const raw = await getSetting(env, SOURCES_SETTING);
  if (raw === null) return STARTER_SOURCES;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return STARTER_SOURCES;
  }
}

/** Saves the accounts and boards to watch. Every line must be a Pinterest account or board. */
export async function setSuggestionSources(env: Env, links: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const raw of links
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)) {
    const t = parsePinterestLink(raw);
    if (!t || t.kind === "pin" || t.kind === "short")
      throw new StudioError(`Not a Pinterest account or board link: ${raw.slice(0, 80)}`);
    const link =
      t.kind === "user"
        ? `https://www.pinterest.com/${t.user}/`
        : `https://www.pinterest.com/${t.user}/${t.board}/`;
    if (!clean.includes(link)) clean.push(link);
  }
  await setSetting(env, SOURCES_SETTING, JSON.stringify(clean));
  await setSetting(env, RUN_SETTING, "0");
  return clean;
}

export async function listSuggestions(env: Env): Promise<Suggestion[]> {
  const rows = await all<Omit<Suggestion, "pins"> & { pins: string }>(
    env.DB,
    "SELECT id, link, title, caption, why, pins, created FROM skill_suggestions WHERE state = 'waiting' ORDER BY created DESC LIMIT 20",
  );
  return rows.map((r) => ({ ...r, pins: JSON.parse(r.pins) as Suggestion["pins"] }));
}

const PICK_SCHEMA = {
  type: "object",
  properties: {
    keep: { type: "array", items: { type: "integer" } },
    name: { type: "string" },
    summary: { type: "string" },
  },
  required: ["keep", "name", "summary"],
};

function pickInstruction(count: number, board: string): string {
  return [
    `You are choosing reference photographs for a fashion studio. ${count} numbered pictures are attached, in order (1 to ${count}), from a Pinterest board called "${board}".`,
    "A picture is USABLE only when it is a real photograph of one adult model, with most of the body visible, standing or moving in a real location or a studio set, so its background, pose and light can be borrowed. NOT usable: pictures with text or logos laid over them, collages or split frames, product-only or flat-lay shots, close-ups of a face or a detail, illustrations, screenshots, pictures with children, pictures with more than two people, swimwear or lingerie.",
    "Keep the usable pictures that also belong together as one look (the same kind of place, light and mood). Return: keep = their numbers; name = a 2 to 4 word name for that look in plain catalogue English (no brand names, no season years); summary = one sentence (max 140 characters) naming the place, light and mood they share.",
    "Return ONLY a JSON object with keys keep, name and summary.",
  ].join("\n\n");
}

/** Asks the vision model which pins of a board are usable references, and what to call the look. */
async function pickLook(
  env: Env,
  board: string,
  pins: Pin[],
): Promise<{ pins: Pin[]; name: string; summary: string } | null> {
  const sample = pins.slice(0, 16);
  const photos = await downloadPins(sample, "236x");
  // downloadPins keeps the order and names each file after its pin.
  const byName = new Map(sample.map((p) => [p.id, p]));
  const ordered = photos
    .map((ph) => byName.get(/pinterest-(\d+)\./.exec(ph.name)?.[1] ?? ""))
    .filter((p): p is Pin => !!p);
  const answer = JSON.parse(
    await askVision(env, pickInstruction(photos.length, board), photos, PICK_SCHEMA),
  ) as { keep?: number[]; name?: string; summary?: string };
  const keep = [...new Set(answer.keep ?? [])]
    .map((n) => ordered[n - 1])
    .filter((p): p is Pin => !!p)
    .slice(0, MAX_PHOTOS);
  if (keep.length < MIN_PHOTOS) return null;
  return {
    pins: keep,
    name: (answer.name ?? "").trim().slice(0, 40) || board.slice(0, 40),
    summary: (answer.summary ?? "").trim().slice(0, 160),
  };
}

/**
 * One pass over the watched accounts: boards not seen before are studied, and the ones with a
 * coherent set of usable photographs are proposed. Runs once a day from the schedule, or at once
 * when an admin asks. A board is recorded even when nothing usable was found, so it is not paid
 * for again.
 */
export async function refreshSuggestions(env: Env, force = false): Promise<number> {
  const last = Number((await getSetting(env, RUN_SETTING)) ?? 0);
  if (!force && now() - last < 24 * 60 * 60_000) return 0;
  await setSetting(env, RUN_SETTING, String(now()));
  const waiting = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM skill_suggestions WHERE state = 'waiting'",
  );
  if ((waiting?.n ?? 0) >= WAITING_LIMIT) return 0;
  const taken = new Set(
    (await all<{ title: string }>(env.DB, "SELECT title FROM skills")).map((s) =>
      s.title.toLowerCase(),
    ),
  );
  let studied = 0;
  let made = 0;
  for (const link of await suggestionSources(env)) {
    if (studied >= BOARDS_PER_PASS) break;
    let source: { title: string; pins: Pin[] };
    try {
      source = await pinterestPins(link);
    } catch (e) {
      console.log("[suggest] source", link, errorMessage(e));
      continue;
    }
    const account = parsePinterestLink(link);
    const accountName =
      account && account.kind !== "pin" && account.kind !== "short" ? account.user : link;
    for (const group of groupByBoard(source.pins, source.title)) {
      if (studied >= BOARDS_PER_PASS) break;
      if (group.pins.length < MIN_PHOTOS + 1) continue;
      const origin = originKey(accountName, group.board);
      if (await first(env.DB, "SELECT id FROM skill_suggestions WHERE origin = ?", origin))
        continue;
      studied++;
      let look: Awaited<ReturnType<typeof pickLook>> = null;
      try {
        look = await pickLook(env, decodeEntities(group.board), group.pins);
      } catch (e) {
        console.error("[suggest] study", origin, errorMessage(e));
        continue;
      }
      const usable = !!look && !taken.has(look.name.toLowerCase());
      const t = now();
      await run(
        env.DB,
        `INSERT OR IGNORE INTO skill_suggestions (id, origin, link, title, caption, why, pins, state, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        origin,
        link,
        look?.name ?? decodeEntities(group.board),
        `Pinterest · ${decodeEntities(source.title)}`.slice(0, 80),
        look?.summary ?? "",
        JSON.stringify(
          (look?.pins ?? []).map((p) => ({ id: p.id, thumb: p.thumb, image: p.image })),
        ),
        usable ? "waiting" : "dismissed",
        t,
        t,
      );
      if (usable) made++;
    }
  }
  console.log("[suggest] pass:", studied, "boards studied,", made, "proposed");
  return made;
}

export async function suggestionRow(env: Env, id: string): Promise<Suggestion> {
  const r = await first<Omit<Suggestion, "pins"> & { pins: string }>(
    env.DB,
    "SELECT id, link, title, caption, why, pins, created FROM skill_suggestions WHERE id = ? AND state = 'waiting'",
    id,
  );
  if (!r) throw new StudioError("That suggestion is no longer waiting.", 404);
  return { ...r, pins: JSON.parse(r.pins) as Suggestion["pins"] };
}

export async function closeSuggestion(
  env: Env,
  id: string,
  state: "approved" | "dismissed",
  skill: string | null = null,
): Promise<void> {
  await run(
    env.DB,
    "UPDATE skill_suggestions SET state = ?, skill = ?, updated = ? WHERE id = ?",
    state,
    skill,
    now(),
    id,
  );
}
