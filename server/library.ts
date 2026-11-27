/**
 * The Pinterest library. The studio gathers pictures from a short list of public accounts and
 * boards; people pick the ones they like into a skill, or hide them. Gathering only reads
 * Pinterest's public feed, so it takes seconds and costs nothing; no skill is made here.
 */
import type { Env } from "./env";
import { errorMessage, StudioError } from "./errors";
import { all, first, now, run } from "./db";
import { getSetting, setSetting } from "./settings";
import { decodeEntities, pinterestPins } from "./pinterest";
import { STARTER_SOURCES, isShopBoard, parsePinterestLink, type Pin } from "@shared/pinterest";

const SOURCES_SETTING = "pinterest_sources";
const RUN_SETTING = "library_last_run";
/** How many of an account's boards are read in full on one pass. */
const BOARDS_PER_ACCOUNT = 5;

export interface LibraryPin {
  id: string;
  account: string;
  board: string;
  thumb: string;
  note: string;
}

export async function librarySources(env: Env): Promise<string[]> {
  const raw = await getSetting(env, SOURCES_SETTING);
  if (raw === null) return STARTER_SOURCES;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return STARTER_SOURCES;
  }
}

/** Saves the accounts and boards to gather from. Every line must be a Pinterest account or board. */
export async function setLibrarySources(env: Env, links: string[]): Promise<string[]> {
  const clean: string[] = [];
  for (const raw of links
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)) {
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

async function keep(env: Env, account: string, pins: Pin[]): Promise<number> {
  let added = 0;
  for (const p of pins) {
    if (isShopBoard(p.board, p.boardUrl)) continue;
    added += await run(
      env.DB,
      `INSERT OR IGNORE INTO pin_library (id, account, board, thumb, image, note, twin, state, seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      p.id,
      account,
      decodeEntities(p.board),
      p.thumb,
      p.image,
      decodeEntities(p.note),
      p.twin,
      now(),
    );
  }
  return added;
}

/** One account or board: its newest pictures, then each of its mood boards read in full. */
async function gather(env: Env, link: string): Promise<number> {
  const source = await pinterestPins(link);
  const account = decodeEntities(source.title);
  let added = await keep(env, account, source.pins);
  const target = parsePinterestLink(link);
  if (target?.kind !== "user") return added;
  const boards = [
    ...new Set(
      source.pins
        .filter((p) => p.boardUrl && !isShopBoard(p.board, p.boardUrl))
        .map((p) => p.boardUrl),
    ),
  ].slice(0, BOARDS_PER_ACCOUNT);
  for (const url of boards) {
    try {
      const board = await pinterestPins(`https://www.pinterest.com${url}`);
      added += await keep(
        env,
        account,
        board.pins.map((p) => ({
          ...p,
          board: p.board || board.title,
          boardUrl: p.boardUrl || url,
        })),
      );
    } catch (e) {
      console.log("[library] board", url, errorMessage(e));
    }
  }
  return added;
}

/**
 * Gathers new pictures from every watched account, side by side. Runs a few times a day from the
 * schedule, or at once when someone asks.
 */
export async function refreshLibrary(env: Env, force = false): Promise<number> {
  const last = Number((await getSetting(env, RUN_SETTING)) ?? 0);
  if (!force && now() - last < 6 * 60 * 60_000) return 0;
  await setSetting(env, RUN_SETTING, String(now()));
  const results = await Promise.all(
    (await librarySources(env)).map((link) =>
      gather(env, link).catch((e) => {
        console.log("[library] source", link, errorMessage(e));
        return 0;
      }),
    ),
  );
  const added = results.reduce((a, b) => a + b, 0);
  console.log("[library] gathered", added, "new pictures");
  return added;
}

export async function listLibrary(
  env: Env,
  account: string | null,
  board: string | null,
  offset: number,
  limit: number,
): Promise<{
  pins: LibraryPin[];
  total: number;
  accounts: { account: string; n: number }[];
  boards: { board: string; n: number }[];
}> {
  const where = ["state = 'new'"];
  const args: string[] = [];
  if (account) {
    where.push("account = ?");
    args.push(account);
    if (board) {
      where.push("board = ?");
      args.push(board);
    }
  }
  const pins = await all<LibraryPin>(
    env.DB,
    `SELECT id, account, board, thumb, note FROM pin_library WHERE ${where.join(" AND ")} ORDER BY seen DESC, id DESC LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  const total = await first<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM pin_library WHERE ${where.join(" AND ")}`,
    ...args,
  );
  const accounts = await all<{ account: string; n: number }>(
    env.DB,
    "SELECT account, COUNT(*) AS n FROM pin_library WHERE state = 'new' GROUP BY account ORDER BY n DESC",
  );
  const boards = account
    ? await all<{ board: string; n: number }>(
        env.DB,
        "SELECT board, COUNT(*) AS n FROM pin_library WHERE state = 'new' AND account = ? GROUP BY board ORDER BY n DESC",
        account,
      )
    : [];
  return { pins, total: total?.n ?? 0, accounts, boards };
}

/** Takes pictures off the library: hidden by a person, or used in a skill. */
export async function markPins(env: Env, ids: string[], state: "hidden" | "used"): Promise<void> {
  for (let i = 0; i < ids.length; i += 40) {
    const group = ids.slice(i, i + 40);
    await run(
      env.DB,
      `UPDATE pin_library SET state = ? WHERE id IN (${group.map(() => "?").join(",")})`,
      state,
      ...group,
    );
  }
}
